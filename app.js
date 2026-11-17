const formulario = document.getElementById("form-incidencia");
const inputTitulo = document.getElementById("titulo");
const inputDescripcion = document.getElementById("descripcion");
const listaOutbox = document.getElementById("lista-outbox");
const botonPurgar = document.getElementById("btn-purgar");
const badgeRed = document.getElementById("badge-red");

const ENDPOINT = "https://jsonplaceholder.typicode.com/posts";

function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = "En Línea";
    badgeRed.className = "badge online";
  } else {
    badgeRed.textContent = "Sin Conexión";
    badgeRed.className = "badge offline";
  }
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = "";

      if (registros.length === 0) {
        const mensaje = document.createElement("li");
        mensaje.className = "vacio";
        mensaje.textContent = "No hay incidencias registradas.";
        listaOutbox.appendChild(mensaje);
        return;
      }

      registros.forEach((item) => {
        const li = document.createElement("li");

        const informacion = document.createElement("div");

        const titulo = document.createElement("strong");
        titulo.textContent = item.titulo;

        const fecha = document.createElement("span");
        fecha.className = "fecha";
        fecha.textContent = new Date(item.fechaCreacion).toLocaleString(
          "es-MX",
        );

        informacion.appendChild(titulo);
        informacion.appendChild(fecha);

        const estado = document.createElement("span");
        estado.className = "estado " + item.estado;
        estado.textContent = item.estado;

        li.appendChild(informacion);
        li.appendChild(estado);

        listaOutbox.appendChild(li);
      });
    })
    .catch((error) => {
      console.error("Error al consultar Outbox:", error);
    });
}

function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(datosFormulario),
  })
    .then((respuesta) => {
      if (!respuesta.ok) {
        throw new Error("Error HTTP del servidor");
      }

      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: "sincronizado",
        fechaCreacion: Date.now(),
      });
    })
    .catch(() => {
      console.warn("[Outbox] Sin conexión. Encolando en IndexedDB...");

      return guardarRegistro({
        ...datosFormulario,
        estado: "pendiente",
        fechaCreacion: Date.now(),
      }).then(() => {
        if ("serviceWorker" in navigator && "SyncManager" in window) {
          return navigator.serviceWorker.ready.then((registro) => {
            console.log("[Outbox] Registrando sync-reportes...");

            return registro.sync.register("sync-reportes");
          });
        }
      });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

function sincronizarPendientesFallback() {
  console.log("[Outbox] Buscando registros pendientes...");

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter(
        (item) => item.estado === "pendiente",
      );

      if (pendientes.length === 0) {
        console.log("[Outbox] No hay registros pendientes.");
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion,
          }),
        }).then((respuesta) => {
          if (!respuesta.ok) {
            throw new Error("Falla al reintentar envío");
          }

          return actualizarEstadoRegistro(item.id, "sincronizado");
        });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error("[Outbox] Error durante la sincronización:", error);
    });
}

formulario.addEventListener("submit", (e) => {
  e.preventDefault();

  const datosFormulario = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim(),
  };

  procesarEnvioReporte(datosFormulario)
    .then(() => {
      formulario.reset();
      console.log("Reporte procesado correctamente.");
    })
    .catch((error) => {
      console.error("Error al procesar reporte:", error);
    });
});

botonPurgar.addEventListener("click", () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter(
        (item) => item.estado === "sincronizado",
      );

      const promesasDeEliminacion = sincronizados.map((item) => {
        return eliminarRegistro(item.id);
      });

      return Promise.all(promesasDeEliminacion);
    })
    .then(() => {
      console.log("Registros sincronizados eliminados.");
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error("Error al purgar registros:", error);
    });
});

if ('serviceWorker' in navigator) {

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (
      event.data &&
      event.data.tipo === 'OUTBOX_SINCRONIZADO'
    ) {
      console.log('[UI] Sincronización confirmada por Service Worker.');
      renderizarColaOutbox();
    }
  });

}

window.addEventListener("online", () => {
  actualizarIndicadorRed();
  if (!("SyncManager" in window)) {
    console.log("[Outbox] Sin SyncManager. Ejecutando fallback...");
    sincronizarPendientesFallback();
  }
});

window.addEventListener("offline", () => {
  actualizarIndicadorRed();
});

actualizarIndicadorRed();
renderizarColaOutbox();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((registro) => {
      console.log("[App] Service Worker registrado:", registro.scope);
    })
    .catch((error) => {
      console.error("[App] Error registrando Service Worker:", error);
    });
}
