importScripts("./db-helper.js");

const CACHE_STATIC_NAME = "static-outbox-v3";

const STATIC_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./db-helper.js",
  "./app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  console.log("[SW] Instalando Service Worker...");

  event.waitUntil(
    caches
      .open(CACHE_STATIC_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log("[SW] App Shell almacenado correctamente.");
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Service Worker activado.");

  event.waitUntil(
    caches
      .keys()
      .then((nombresCache) => {
        const eliminaciones = nombresCache.map((nombre) => {
          if (nombre !== CACHE_STATIC_NAME) {
            return caches.delete(nombre);
          }
        });

        return Promise.all(eliminaciones);
      })
      .then(() => {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  // No interceptar peticiones a servidores externos
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return respuestaCache || fetch(event.request);
    }),
  );
});

function notificarClientesActualizacion() {
  return self.clients
    .matchAll({
      type: "window",
      includeUncontrolled: true,
    })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: "OUTBOX_SINCRONIZADO",
          timestamp: Date.now(),
        });
      });
    });
}

function sincronizarPendientesSW() {
  console.log("[SW-Sync] Buscando transacciones pendientes...");

  return obtenerTodosLosRegistros().then((registros) => {
    const pendientes = registros.filter((item) => item.estado === "pendiente");

    if (pendientes.length === 0) {
      console.log("[SW-Sync] No hay registros pendientes.");
      return;
    }

    const promesasDeEnvio = pendientes.map((item) => {
      return fetch("https://jsonplaceholder.typicode.com/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: item.titulo,
          body: item.descripcion,
        }),
      })
        .then((respuesta) => {
          if (!respuesta.ok) {
            throw new Error(
              `Error HTTP ${respuesta.status} al sincronizar ID ${item.id}`,
            );
          }

          return actualizarEstadoRegistro(item.id, "sincronizado");
        })
        .catch((error) => {
          console.error(`[SW-Sync] Error al sincronizar ID ${item.id}:`, error);

          throw error;
        });
    });

    return Promise.all(promesasDeEnvio).then(() => {
      console.log("[SW-Sync] Sincronización completada.");
      return notificarClientesActualizacion();
    });
  });
}

self.addEventListener("sync", (event) => {
  console.log("[SW-Sync] Evento recibido:", event.tag);

  if (event.tag === "sync-reportes") {
    event.waitUntil(
      sincronizarPendientesSW().catch((error) => {
        console.error("[SW-Sync] Error. El navegador podrá reintentar:", error);

        throw error;
      }),
    );
  }
});
