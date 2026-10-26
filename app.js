/* Zori Delivery · app.js
 * Datos (Google Sheets o CSV) + página de local + carrito + pedido por WhatsApp.
 * Lo único que normalmente se toca es ZORI_CONFIG.
 */
const ZORI_CONFIG = {
  // Pegá acá el ID de tu Google Sheet (lo que está entre /d/ y /edit en la URL).
  // Vacío = usa los archivos data/locales.csv y data/productos.csv del sitio.
  SHEET_ID: "1SykSOH61COs6gVVO1yLHw69l074qPx6eSABYk3xfcF8",
  // Nombres de las pestañas en la hoja de Google
  TAB_LOCALES: "Locales",
  TAB_PRODUCTOS: "Productos",
  // Minutos que se guardan los datos en el navegador antes de volver a pedirlos
  CACHE_MIN: 5,
  WHATSAPP_DEFAULT: "595982309464",
  FIREBASE: {
    apiKey: "AIzaSyCoIVVXK3csLvtg9E7wDCjGt--fam_szzQ",
    authDomain: "admin-de-zory.firebaseapp.com",
    projectId: "admin-de-zory",
    storageBucket: "admin-de-zory.firebasestorage.app",
    messagingSenderId: "199468715480",
    appId: "1:199468715480:web:2a7a188258237c0b5db6ad",
    measurementId: "G-WKGL0G4WK4",
  },
};

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gs = (n) => "Gs. " + Number(n).toLocaleString("es-PY");
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const si = (v) => !["no", "n", "0", "false", "agotado"].includes(norm(v));

function imgUrl(v, carpeta) {
  v = String(v || "").trim();
  if (!v) return "";
  if (/^(https?:)?\/\//.test(v) || v.startsWith("data:")) return v;
  return encodeURI(v);
}

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => norm(h).replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/* ---------- carga de datos ---------- */
async function fetchCSV(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return parseCSV(await r.text());
}

async function cargarDatos() {
  const KEY = "zori-datos-v1";
  const ahora = Date.now();
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (cache && ahora - cache.t < ZORI_CONFIG.CACHE_MIN * 60000 && cache.fuente === (ZORI_CONFIG.SHEET_ID || "local")) {
    return cache.d;
  }
  let datos;
  try {
    if (ZORI_CONFIG.SHEET_ID) {
      const base = `https://docs.google.com/spreadsheets/d/${ZORI_CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=`;
      const [l, p] = await Promise.all([
        fetchCSV(base + encodeURIComponent(ZORI_CONFIG.TAB_LOCALES)),
        fetchCSV(base + encodeURIComponent(ZORI_CONFIG.TAB_PRODUCTOS)),
      ]);
      if (!l.length || !("id" in l[0]) || !("nombre" in l[0])) {
        throw new Error("Google no devolvió la pestaña '" + ZORI_CONFIG.TAB_LOCALES + "' (¿hoja sin compartir o nombre de pestaña distinto?)");
      }
      if (!p.length || !("local" in p[0]) || !("nombre" in p[0])) {
        throw new Error("Google no devolvió la pestaña '" + ZORI_CONFIG.TAB_PRODUCTOS + "'");
      }
      datos = { locales: l, productos: p };
      window.ZORI_FUENTE = "Google Sheets";
    } else throw new Error("sin sheet");
  } catch (e) {
    if (ZORI_CONFIG.SHEET_ID) {
      console.warn("No se pudo leer Google Sheets, uso los CSV del sitio.", e);
      window.ZORI_MOTIVO = String(e.message || e);
    }
    window.ZORI_FUENTE = "CSV de respaldo";
    try {
      const [l, p] = await Promise.all([fetchCSV("locales.csv"), fetchCSV("productos.csv")]);
      datos = { locales: l, productos: p };
    } catch (e2) {
      if (cache) return cache.d; // último dato bueno
      throw e2;
    }
  }
  datos = normalizar(datos);
  try { localStorage.setItem(KEY, JSON.stringify({ t: ahora, fuente: ZORI_CONFIG.SHEET_ID || "local", d: datos })); } catch (e) {}
  return datos;
}

function parseVariantes(txt) {
  return String(txt || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.lastIndexOf(":");
      if (i < 0) return null;
      const precio = parseInt(x.slice(i + 1).replace(/\D/g, ""), 10);
      return isNaN(precio) ? null : { etiqueta: x.slice(0, i).trim(), precio };
    })
    .filter(Boolean);
}

function normalizar(d) {
  const locales = d.locales
    .filter((l) => l.id && l.nombre && si(l.activo || "si"))
    .map((l) => ({
      id: slug(l.id),
      nombre: l.nombre,
      categorias: (l.categoria || "restaurantes").split(/[,;]/).map((c) => slug(c)).filter(Boolean),
      destacado: l.destacado ? !["no", "", "0"].includes(norm(l.destacado)) : false,
      logo: l.logo || "",
      banner: l.banner || l.logo || "",
      whatsapp: String(l.whatsapp || "").replace(/\D/g, "") || ZORI_CONFIG.WHATSAPP_DEFAULT,
      ciudad: l.ciudad || "",
      horario: l.horario || "",
    }));
  const ids = new Set(locales.map((l) => l.id));
  const productos = d.productos
    .filter((p) => p.local && p.nombre && ids.has(slug(p.local)))
    .map((p, i) => {
      const variantes = parseVariantes(p.variantes);
      const precio = parseInt(String(p.precio || "").replace(/\D/g, ""), 10);
      return {
        key: slug(p.local) + "#" + i,
        local: slug(p.local),
        categoria: p.categoria || "Menú",
        nombre: p.nombre,
        descripcion: p.descripcion || "",
        precio: isNaN(precio) ? null : precio,
        variantes,
        imagen: p.imagen || "",
        disponible: si(p.disponible || "si"),
        nombrePedido: p.nombre_pedido || "",
      };
    })
    .filter((p) => p.variantes.length || p.precio !== null);
  return { locales, productos };
}

/* ---------- pantalla de carga / sin conexión ---------- */
function crearLoader() {
  if ($("#zory-loader")) return;
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div id="zory-loader"><img src="logo png.png" alt="Zori"><h2 id="loader-text">Cargando Zori...</h2><p id="loader-sub">Preparando experiencia</p></div>`
  );
}
function ocultarLoader() {
  const l = $("#zory-loader");
  if (!l) return;
  l.style.opacity = "0";
  setTimeout(() => (l.style.display = "none"), 500);
}
window.addEventListener("offline", () => {
  const l = $("#zory-loader");
  if (!l) return;
  $("#loader-text").textContent = "¡Sin conexión!";
  $("#loader-sub").textContent = "Revisá tu internet";
  l.style.display = "flex"; l.style.opacity = "1";
});
window.addEventListener("online", ocultarLoader);

/* ---------- selector de ciudad ---------- */
function initCiudad() {
  const btn = $("#btnUbicacion"), dd = $("#dropdownUbicacion"), txt = $("#textoUbicacion");
  if (!btn || !dd) return;
  try { const c = localStorage.getItem("zori-ciudad"); if (c && txt) txt.textContent = c; } catch (e) {}
  btn.addEventListener("click", (e) => { e.stopPropagation(); dd.style.display = dd.style.display === "block" ? "none" : "block"; });
  document.addEventListener("click", () => (dd.style.display = "none"));
  window.cambiarUbicacion = (ciudad) => {
    if (txt) txt.textContent = ciudad;
    try { localStorage.setItem("zori-ciudad", ciudad); } catch (e) {}
    dd.style.display = "none";
  };
}

/* ---------- Firebase (pedidos) ---------- */
let db = null;
function initFirebase() {
  if (typeof firebase === "undefined") return;
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(ZORI_CONFIG.FIREBASE);
      if (firebase.analytics) firebase.analytics();
    }
    if (firebase.firestore) db = firebase.firestore();
  } catch (e) { console.error(e); }
}

/* =====================================================================
 *  PÁGINA DE LOCAL (local.html?id=bacoa)
 * ===================================================================== */
const Carrito = {
  local: null,   // objeto local
  items: {},     // key -> { nombre, precio, qty }
  guardar() { try { sessionStorage.setItem("zori-cart-" + this.local.id, JSON.stringify(this.items)); } catch (e) {} },
  cargar() { try { this.items = JSON.parse(sessionStorage.getItem("zori-cart-" + this.local.id) || "{}"); } catch (e) { this.items = {}; } },
  cambiar(key, nombre, precio, delta) {
    const it = this.items[key] || (this.items[key] = { nombre, precio, qty: 0 });
    it.qty += delta;
    if (it.qty <= 0) delete this.items[key];
    this.guardar();
    pintarCantidades();
    pintarBarra();
  },
  totales() {
    let n = 0, t = 0;
    for (const k in this.items) { n += this.items[k].qty; t += this.items[k].qty * this.items[k].precio; }
    return { n, t };
  },
};

function nombrePedido(p, v) {
  const base = p.nombrePedido || p.nombre;
  return v ? `${base} (${v.etiqueta})` : base;
}

function tarjetaProducto(p) {
  const img = imgUrl(p.imagen, "productos");
  const agotado = !p.disponible;
  let acciones = "";
  if (p.variantes.length) {
    acciones = `<div class="zp-variantes">` + p.variantes.map((v, i) => {
      const key = `${p.key}:${i}`;
      return `<div class="zp-var" data-key="${esc(key)}">
        <span class="zp-var-et">${esc(v.etiqueta)}</span>
        <span class="zp-var-pr">${gs(v.precio)}</span>
        <span class="zp-slot" data-key="${esc(key)}" data-nombre="${esc(nombrePedido(p, v))}" data-precio="${v.precio}" ${agotado ? "data-off" : ""}></span>
      </div>`;
    }).join("") + `</div>`;
  } else {
    const key = p.key;
    acciones = `<span class="prod-price">${gs(p.precio)}</span>
      <span class="zp-slot" data-key="${esc(key)}" data-nombre="${esc(nombrePedido(p))}" data-precio="${p.precio}" ${agotado ? "data-off" : ""}></span>`;
  }
  return `<div class="product-card${agotado ? " zp-agotado" : ""}">
    ${img ? `<img src="${esc(img)}" alt="${esc(p.nombre)}" loading="lazy" onerror="this.remove()">` : ""}
    <div class="prod-info">
      <h4>${esc(p.nombre)}${agotado ? ' <em class="zp-tag">Agotado</em>' : ""}</h4>
      ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ""}
      ${acciones}
    </div>
  </div>`;
}

function pintarCantidades() {
  document.querySelectorAll(".zp-slot").forEach((s) => {
    const key = s.dataset.key;
    const qty = Carrito.items[key] ? Carrito.items[key].qty : 0;
    if (s.hasAttribute("data-off")) { s.innerHTML = `<button class="btn-pedir" disabled>AGOTADO</button>`; return; }
    s.innerHTML = qty
      ? `<span class="controls"><button class="btn-qty" data-act="menos" aria-label="Quitar">−</button><span class="qty-count">${qty}</span><button class="btn-qty" data-act="mas" aria-label="Agregar">+</button></span>`
      : `<button class="btn-pedir" data-act="mas">PEDIR</button>`;
  });
}

function pintarBarra() {
  const { n, t } = Carrito.totales();
  const bar = $("#zcartBar");
  if (!bar) return;
  if (!n) { bar.style.display = "none"; cerrarCarrito(); return; }
  bar.style.display = "flex";
  $("#zcartCount").textContent = `${n} ${n === 1 ? "producto" : "productos"}`;
  $("#zcartTotal").textContent = gs(t);
  if ($("#zmodal").style.display === "flex") pintarModal();
}

function pintarModal() {
  const lista = $("#zlista");
  lista.innerHTML = Object.entries(Carrito.items).map(([k, it]) => `
    <div class="zrow">
      <div><strong>${esc(it.nombre)}</strong><br><small>${it.qty} × ${gs(it.precio)} = <b>${gs(it.qty * it.precio)}</b></small></div>
      <span class="controls" data-key="${esc(k)}"><button class="btn-qty" data-m="menos">−</button><span class="qty-count">${it.qty}</span><button class="btn-qty" data-m="mas">+</button></span>
    </div>`).join("");
  $("#ztotal").textContent = gs(Carrito.totales().t);
}
function abrirCarrito() { pintarModal(); $("#zmodal").style.display = "flex"; }
function cerrarCarrito() { const m = $("#zmodal"); if (m) m.style.display = "none"; }

function enviarPedido() {
  const nombre = $("#znombre").value.trim();
  if (!nombre) { alert("Por favor, ingresá tu nombre para continuar."); $("#znombre").focus(); return; }
  const lista = Object.values(Carrito.items);
  if (!lista.length) return;
  const total = lista.reduce((a, i) => a + i.qty * i.precio, 0);
  const local = Carrito.local;
  if (db) {
    db.collection("pedidos").add({
      cliente: nombre,
      tienda: local.nombre,
      productos: lista.map((i) => ({ cantidad: i.qty, nombre: i.nombre })),
      total,
      estado: "pendiente",
      hora: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      creado: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((e) => console.error("Error al registrar pedido en Firebase:", e));
  }
  let msg = `Nuevo Pedido\n\nHola Zory, quiero hacer un pedido de *${local.nombre}*:\n\n`;
  lista.forEach((i) => (msg += `- ${i.qty}: ${i.nombre}\n`));
  msg += `\nTotal: ${gs(total)}\n\nA nombre de: ${nombre}\n`;
  window.open(`https://wa.me/${local.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank");
}

function montarCarritoUI() {
  document.body.insertAdjacentHTML("beforeend", `
    <div id="zcartBar" role="button" tabindex="0">🛒 <span id="zcartCount">0</span> • <span id="zcartTotal">Gs. 0</span></div>
    <div id="zmodal">
      <div class="zbox">
        <div class="zhead"><h3>Tu pedido</h3><button id="zclose" aria-label="Cerrar">&times;</button></div>
        <div id="zlista"></div>
        <label for="znombre" class="zlabel">Tu nombre:</label>
        <input id="znombre" type="text" placeholder="Nombre" autocomplete="name">
        <div class="znota">📍 <strong>Recordatorio:</strong> enviá tu ubicación actual desde el chat</div>
        <div class="ztot"><span>Total:</span><span id="ztotal">Gs. 0</span></div>
        <button id="zsend">💬 Pedir ahora</button>
      </div>
    </div>`);
  $("#zcartBar").addEventListener("click", abrirCarrito);
  $("#zclose").addEventListener("click", cerrarCarrito);
  $("#zmodal").addEventListener("click", (e) => { if (e.target.id === "zmodal") cerrarCarrito(); });
  $("#zsend").addEventListener("click", enviarPedido);
  $("#zlista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    const key = b.parentElement.dataset.key;
    const it = Carrito.items[key];
    if (it) Carrito.cambiar(key, it.nombre, it.precio, b.dataset.m === "mas" ? 1 : -1);
  });
}

async function initLocal() {
  const id = slug(new URLSearchParams(location.search).get("id") || "");
  const cont = $("#menuContainer");
  let datos;
  try { datos = await cargarDatos(); window.__datos = datos; }
  catch (e) {
    cont.innerHTML = `<p class="zmsg">No pudimos cargar el menú. Revisá tu conexión e intentá de nuevo.</p>`;
    ocultarLoader(); return;
  }
  const local = datos.locales.find((l) => l.id === id);
  if (!local) {
    cont.innerHTML = `<p class="zmsg">No encontramos ese local. <a href="locales.html">Ver todos los locales</a></p>`;
    ocultarLoader(); return;
  }
  Carrito.local = local;
  Carrito.cargar();
  document.title = `${local.nombre} - Zori Delivery`;
  const banner = imgUrl(local.banner, "locales");
  if (banner) { $("#storeBanner").src = banner; $("#storeBanner").alt = local.nombre; }
  else { $("#storeBanner").remove(); $(".promo-banner").style.height = "56px"; $(".promo-banner").style.background = "var(--zori-orange)"; }
  $("#storeTitle").textContent = local.nombre;
  if (local.horario) { const h = $("#storeHorario"); h.textContent = "🕒 " + local.horario; h.hidden = false; }

  const prods = datos.productos.filter((p) => p.local === id);
  const cats = [];
  prods.forEach((p) => { if (!cats.includes(p.categoria)) cats.push(p.categoria); });
  $("#storeCats").innerHTML = cats.length > 1
    ? cats.map((c, i) => `<a href="#cat-${i}">${esc(c)}</a>`).join("")
    : "";
  cont.innerHTML = cats.map((c, i) => `
    <h2 class="section-title" id="cat-${i}">${esc(c)}</h2>
    <section class="products-grid">${prods.filter((p) => p.categoria === c).map(tarjetaProducto).join("")}</section>`).join("")
    || `<p class="zmsg">Este local todavía no tiene productos cargados.</p>`;

  montarCarritoUI();
  cont.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const s = b.closest(".zp-slot");
    Carrito.cambiar(s.dataset.key, s.dataset.nombre, Number(s.dataset.precio), b.dataset.act === "mas" ? 1 : -1);
  });
  pintarCantidades();
  pintarBarra();
  ocultarLoader();
}

/* =====================================================================
 *  LISTADO DE LOCALES (locales.html)
 * ===================================================================== */
const CAT_INFO = {
  restaurantes: ["Restaurantes", "fa-utensils", "Restaurantes 🍽️"],
  bodega: ["Bodega", "fa-wine-bottle", "Bodegas 🍷"],
  farmacia: ["Farmacia", "fa-pills", "Farmacias 💊"],
  supermercados: ["Supermercados", "fa-cart-shopping", "Supermercados 🛒"],
  postres: ["Postres", "fa-ice-cream", "Postres 🍨"],
};
const catInfo = (c) => CAT_INFO[c] || [c.charAt(0).toUpperCase() + c.slice(1), "fa-tag", c];

function initListado(datos) {
  const grid = $("#stores-container");
  const titulo = $("#titulo-seccion");
  const chips = $("#chips");
  const buscador = $("#search-input");
  const { locales, productos } = datos;

  // índice de búsqueda: nombre del local + nombres de sus productos
  const idx = {};
  productos.forEach((p) => { (idx[p.local] = idx[p.local] || []).push(norm(p.nombre)); });

  const cats = [];
  locales.forEach((l) => l.categorias.forEach((c) => { if (!cats.includes(c)) cats.push(c); }));
  const hayDestacados = locales.some((l) => l.destacado);
  const chipDefs = [["todos", "Todos", "fa-store"]];
  if (hayDestacados) chipDefs.push(["vendidos", "Los más vendidos", "fa-fire"]);
  cats.forEach((c) => chipDefs.push([c, catInfo(c)[0], catInfo(c)[1]]));
  chips.innerHTML = chipDefs.map(([k, n, ic], i) =>
    `<div class="category-chip${i === 0 ? " active" : ""}" data-cat="${esc(k)}"><i class="fa-solid ${ic}"></i> ${esc(n)}</div>`).join("");

  function render(lista) {
    if (!lista.length) { grid.innerHTML = `<p style="grid-column: span 2; text-align:center; color:#888; padding:20px;">No hay locales en esta categoría por el momento.</p>`; }
    else grid.innerHTML = lista.map((l) => `
      <a class="store-card" href="local.html?id=${encodeURIComponent(l.id)}" style="text-decoration:none">
        <img src="${esc(imgUrl(l.logo, "locales"))}" alt="${esc(l.nombre)}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="store-info"><h3>${esc(l.nombre)}</h3></div>
      </a>`).join("");
    for (let i = 0; i < 2; i++) {
      grid.insertAdjacentHTML("beforeend", `<div class="store-card add-store" data-wa="1"><i class="fa-solid fa-store-slash"></i><h3>¡Agrega tu local!</h3><p>Únete a Zori Delivery</p></div>`);
    }
  }
  function filtrar(cat) {
    if (cat === "todos") { titulo.textContent = "Locales Disponibles"; return render(locales); }
    if (cat === "vendidos") { titulo.textContent = "Los más vendidos 🔥"; return render(locales.filter((l) => l.destacado)); }
    titulo.textContent = catInfo(cat)[2];
    render(locales.filter((l) => l.categorias.includes(cat)));
  }
  chips.addEventListener("click", (e) => {
    const c = e.target.closest(".category-chip");
    if (!c) return;
    chips.querySelectorAll(".category-chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    buscador.value = "";
    filtrar(c.dataset.cat);
  });
  grid.addEventListener("click", (e) => {
    if (e.target.closest("[data-wa]")) {
      const m = "¡Hola Zori Delivery! 📱 Me interesa agregar mi local a la plataforma. ¿Me podrían dar info sobre cómo funciona?";
      window.open(`https://wa.me/${ZORI_CONFIG.WHATSAPP_DEFAULT}?text=${encodeURIComponent(m)}`, "_blank");
    }
  });
  buscador.addEventListener("input", () => {
    const t = norm(buscador.value);
    if (!t) { chips.querySelector(".category-chip.active").click(); return; }
    titulo.textContent = "Resultados de búsqueda";
    render(locales.filter((l) => norm(l.nombre).includes(t) || (idx[l.id] || []).some((n) => n.includes(t))));
  });

  const cat = new URLSearchParams(location.search).get("cat");
  const chip = cat && [...chips.children].find((c) => c.dataset.cat === cat);
  if (chip) chip.click(); else render(locales);
}

/* ---------- reseña anónima ---------- */
window.abrirModalReseña = () => {
  $("#formContainer").style.display = "block";
  $("#mensajeExito").style.display = "none";
  $("#mensajeReseña").value = "";
  $("#modalReseña").style.display = "flex";
};
window.cerrarModalReseña = () => ($("#modalReseña").style.display = "none");
window.enviarReseñaAnonima = (event) => {
  event.preventDefault();
  const btn = $("#btnEnviar");
  btn.textContent = "Enviando..."; btn.disabled = true;
  fetch("https://formsubmit.co/ajax/zorydelivery@gmail.com", { method: "POST", body: new FormData($("#reseñaForm")) })
    .then((r) => r.json())
    .then(() => { $("#formContainer").style.display = "none"; $("#mensajeExito").style.display = "block"; })
    .catch(() => alert("Error al enviar. Inténtalo de nuevo."))
    .finally(() => { btn.textContent = "Enviar"; btn.disabled = false; });
};

/* ---------- diagnóstico: agregá ?debug=1 a la URL ---------- */
function mostrarDebug(datos) {
  if (!/[?&]debug=1/.test(location.search)) return;
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100000;background:#111;color:#fff;font:12px/1.4 monospace;padding:8px 12px;white-space:pre-wrap";
  d.textContent = `Fuente: ${window.ZORI_FUENTE || "caché"}\nLocales: ${datos ? datos.locales.length : "?"} · Productos: ${datos ? datos.productos.length : "?"}` +
    (window.ZORI_MOTIVO ? `\nMotivo del respaldo: ${window.ZORI_MOTIVO}` : "") + `\nSHEET_ID: ${ZORI_CONFIG.SHEET_ID || "(vacío)"}`;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

/* ---------- arranque ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  crearLoader();
  initCiudad();
  initFirebase();
  const page = document.body.dataset.page;
  if (page === "local") { await initLocal(); return mostrarDebug(window.__datos); }
  if (page === "locales") {
    try { const d = await cargarDatos(); window.__datos = d; initListado(d); mostrarDebug(d); }
    catch (e) { $("#stores-container").innerHTML = `<p style="grid-column: span 2; text-align:center; color:#888; padding:20px;">No pudimos cargar los locales. Revisá tu conexión.</p>`; }
    ocultarLoader();
  }
});
