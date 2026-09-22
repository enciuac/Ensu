"use strict";
/* ════════════════════════════════════════════════════════════
   EnSu — biblioteca personal
   Estructura:
     1. Constantes
     2. Utilidades
     3. Store  → ÚNICA capa que habla con la base de datos
     4. Portadas
     5. Router y vistas
     6. Formularios, login, tareas
     7. Init
════════════════════════════════════════════════════════════ */

/* ══ 1. CONSTANTES ══ */
/* Supabase: la clave publishable es pública por diseño; la protección la da RLS. */
const SUPABASE_URL="https://wgtolhgtdpxasliaaxaa.supabase.co";
const SUPABASE_KEY="sb_publishable_Ze4N3Wl2SyqnBmEtRlcO-A_M1drZqmX";
const TIPOS={
  libro:    {l:"Libro",     pl:"Libros",      c:"var(--accent)",i:"i-book"},
  articulo: {l:"Artículo",  pl:"Artículos",   c:"var(--indigo)",i:"i-doc"},
  reflexion:{l:"Reflexión", pl:"Reflexiones", c:"var(--sage)",  i:"i-pen"},
  privado:  {l:"Privado",   pl:"Privado",     c:"var(--plum)",  i:"i-lock"}
};
const ESTADOS={leyendo:"Leyendo",terminado:"Terminado",proximo:"Próximo",pendiente:"Pendiente"};
const POR_LEER=new Set(["proximo","pendiente"]);
const FINALIDADES=["Formación","Autoconocimiento","Ocio"];
const CATEGORIAS=["Psicología","Relaciones","Desarrollo personal","Filosofía","Productividad","Pensamiento y decisiones","Finanzas","Ciencia","Geopolítica","Marketing","Novela"];
const DIFICULTADES=["Accesible","Moderada","Densa","Muy densa"];
const MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MESES_C=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const COVER_TONOS=["#3E4A3D","#5B3A2E","#2F3D55","#6B4E2E","#4A3553","#2E4F4F","#7A3B3B","#3B3B45","#5A5230","#27433A"];

/* ══ 2. UTILIDADES ══ */
const $=id=>document.getElementById(id);
const $$=(sel,root=document)=>[...root.querySelectorAll(sel)];
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function icon(name,cls=""){return`<svg class="i ${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;}
function hash(s){let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return Math.abs(h);}
function norma(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");}
function hoyISO(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function fechaLarga(iso){if(!iso)return"";const[y,m,d]=iso.split("-");if(!m)return y;return`${+d} ${MESES_C[+m-1]} ${y}`;}
/* Fecha pública = solo el año. El autor ve la fecha completa. */
function fechaUI(iso){if(!iso)return"";return Store.isAdmin()?fechaLarga(iso):iso.slice(0,4);}
function fechaNum(e){return e.fecha?Date.parse(e.fecha)||0:0;}
/* Texto enriquecido: párrafos por doble salto. Si un párrafo empieza con una línea
   corta sin punto final, se muestra como subtítulo (útil para notas por puntos). */
function txRich(str){
  if(!str)return"";
  return str.trim().split(/\n\s*\n/).map(p=>{
    const lines=p.split("\n");
    const esItem=l=>/^\s*[-•·*]\s+/.test(l);
    if(lines.some(esItem)&&lines.filter(esItem).length>=2){
      let html="",ul=[];
      const flush=()=>{if(ul.length){html+=`<ul>${ul.map(li=>`<li>${esc(li)}</li>`).join("")}</ul>`;ul=[];}};
      lines.forEach(l=>{if(esItem(l))ul.push(l.replace(/^\s*[-•·*]\s+/,""));else{flush();if(l.trim())html+=`<p>${esc(l)}</p>`;}});
      flush();return html;
    }
    if(lines.length>1){
      const h=lines[0].trim();
      if(h.length<=90&&!/[.:;]$/.test(h))return`<p><strong>${esc(h)}</strong>${lines.slice(1).map(esc).join("<br>")}</p>`;
    }
    return`<p>${lines.map(esc).join("<br>")}</p>`;
  }).join("");
}
function plano(str){return String(str||"").replace(/\s+/g," ").trim();}
let _toastT;
function toast(msg,tipo){const t=$("toast");t.textContent=msg;t.className="toast show"+(tipo==="error"?" error":"");clearTimeout(_toastT);_toastT=setTimeout(()=>t.classList.remove("show"),tipo==="error"?5200:3000);}
function errTxt(err){
  const c=err?`${err.code||""} ${err.message||""}`:"";
  if(/42501|row-level|permission|JWT|not authorized/i.test(c))return"Sin permiso para guardar. Inicia sesión de nuevo.";
  if(/network|fetch|unavailable|offline/i.test(c))return"Sin conexión. Inténtalo de nuevo.";
  if(/23514|check constraint/i.test(c))return"Algún dato no es válido. Revisa el formulario.";
  return"No se pudo guardar. Inténtalo de nuevo.";
}

/* ══ 3. STORE ══
   Toda lectura/escritura pasa por aquí (Supabase). La seguridad la aplica la base
   de datos con Row Level Security (ver supabase/01_esquema.sql):
     entradas        públicas, salvo tipo "privado" (solo autor)
     notas_privadas  solo autor
     tareas          solo autor                                                    */
const Store=(()=>{
  let sb,admin=false,cargado=false,errorCarga=null;
  let entradasDb=[],notas={},tareas=[],ajustes={},historial=[],firmaEntradas="";
  const subs=new Set(),authSubs=new Set();
  const emit=()=>subs.forEach(f=>f());
  const numOr=(v,d)=>{const n=Number(v);return Number.isFinite(n)?n:d;};

  /* Base de datos (snake_case) → app (camelCase) */
  function norm(r0){
    // Saltos de línea de Windows (\r\n) → \n, para que textos pegados se vean y editen igual
    const r={};for(const k in r0)r[k]=typeof r0[k]==="string"?r0[k].replace(/\r\n?/g,"\n"):r0[k];
    const n={
      id:Number(r.id),tipo:TIPOS[r.tipo]?r.tipo:"libro",estado:ESTADOS[r.estado]?r.estado:"terminado",
      libro:r.libro||"",autor:r.autor||"",fecha:r.fecha||"",tituloRef:r.titulo_ref||"",
      reflexion:r.reflexion||"",cita:r.cita||"",vida:r.vida||"",tension:r.tension||"",
      finalidad:r.finalidad||"",categoria:r.categoria||"",dificultad:r.dificultad||"",
      tags:Array.isArray(r.tags)?r.tags.filter(Boolean):[],
      progreso:Math.min(100,Math.max(0,numOr(r.progreso,0))),
      puntuacion:r.puntuacion||null,paginasTotal:r.paginas_total||null,
      paginaActual:r.pagina_actual==null?null:numOr(r.pagina_actual,null),
      orden:r.orden||null,portada:r.portada||"",portadaId:numOr(r.portada_id,0),
      terminadoEn:r.terminado_en||""
    };
    return n;
  }
  /* App → base de datos. Solo incluye los campos presentes. */
  const MAPA={tipo:"tipo",estado:"estado",libro:"libro",autor:"autor",fecha:"fecha",tituloRef:"titulo_ref",reflexion:"reflexion",cita:"cita",vida:"vida",tension:"tension",finalidad:"finalidad",categoria:"categoria",dificultad:"dificultad",tags:"tags",progreso:"progreso",puntuacion:"puntuacion",paginasTotal:"paginas_total",paginaActual:"pagina_actual",orden:"orden",portada:"portada",portadaId:"portada_id",terminadoEn:"terminado_en"};
  function aDb(o){
    const r={};
    for(const[k,col]of Object.entries(MAPA)){
      if(!(k in o))continue;
      let v=o[k];
      if(k==="fecha"||k==="terminadoEn")v=/^\d{4}-\d{2}-\d{2}$/.test(v||"")?v:null;
      else if(k==="tags")v=Array.isArray(v)?v:[];
      else if(["puntuacion","paginasTotal","paginaActual","orden"].includes(k))v=v==null||v===""||!Number.isFinite(Number(v))?null:Math.round(Number(v));
      else if(k==="progreso"||k==="portadaId")v=Math.round(numOr(v,0));
      else v=v==null?"":String(v);
      r[col]=v;
    }
    return r;
  }
  const ok=({data,error})=>{if(error)throw error;return data;};
  /* Si aún no se ha ejecutado supabase/03_mejoras.sql, la columna terminado_en no existe:
     se reintenta sin ella para que guardar nunca falle por eso. */
  const sinColumnaNueva=err=>/terminado_en/.test(`${err&&err.message} ${err&&err.details}`);
  async function escribir(fn,fila){
    try{return ok(await fn(fila));}
    catch(err){if(!sinColumnaNueva(err)||!("terminado_en" in fila))throw err;const{terminado_en,...resto}=fila;return ok(await fn(resto));}
  }

  async function cargarEntradas(){
    try{
      const filas=ok(await sb.from("entradas").select("*").order("id"));
      const firma=JSON.stringify(filas);
      if(firma===firmaEntradas&&cargado&&!errorCarga)return;
      firmaEntradas=firma;
      entradasDb=filas.map(norm);
      errorCarga=null;
    }catch(err){errorCarga=err;console.warn("EnSu carga:",err&&err.message);}
    cargado=true;emit();
  }
  async function cargarPrivado(){
    if(!admin){notas={};tareas=[];historial=[];return;}
    const intento=async(f)=>{try{await f();}catch(err){console.warn("EnSu privado:",err&&err.message);}};
    await Promise.all([
      intento(async()=>{const n={};ok(await sb.from("notas_privadas").select("entrada_id,texto")).forEach(x=>{if(x.texto)n[x.entrada_id]=x.texto;});notas=n;}),
      intento(async()=>{tareas=ok(await sb.from("tareas").select("*").order("id")).map(t=>({id:Number(t.id),titulo:t.titulo||"",detalles:t.detalles||"",estado:t.estado||"pendiente",fecha:t.fecha||""}));}),
      intento(async()=>{historial=ok(await sb.from("lecturas_progreso").select("entrada_id,momento,pagina,progreso").order("momento")).map(h=>({id:Number(h.entrada_id),t:Date.parse(h.momento),pagina:h.pagina,progreso:h.progreso}));})
    ]);
    emit();
  }
  /* Ajustes públicos (reto anual…). Si la tabla aún no existe, se ignora. */
  async function cargarAjustes(){
    try{const a={};ok(await sb.from("ajustes").select("clave,valor")).forEach(x=>{a[x.clave]=x.valor;});ajustes=a;emit();}
    catch(err){console.warn("EnSu ajustes:",err&&err.message);}
  }
  /* Tiempo real: ante cualquier cambio se recarga la tabla afectada (son pocos datos). */
  const timers={};
  const recargar=(k,f)=>{clearTimeout(timers[k]);timers[k]=setTimeout(f,120);};
  function suscribir(){
    sb.channel("ensu")
      .on("postgres_changes",{event:"*",schema:"public",table:"entradas"},()=>recargar("e",cargarEntradas))
      .on("postgres_changes",{event:"*",schema:"public",table:"notas_privadas"},()=>recargar("p",cargarPrivado))
      .on("postgres_changes",{event:"*",schema:"public",table:"tareas"},()=>recargar("p",cargarPrivado))
      .on("postgres_changes",{event:"*",schema:"public",table:"lecturas_progreso"},()=>recargar("p",cargarPrivado))
      .on("postgres_changes",{event:"*",schema:"public",table:"ajustes"},()=>recargar("a",cargarAjustes))
      .subscribe();
  }
  async function comprobarAutor(session){
    let es=false;
    if(session){try{es=!!ok(await sb.rpc("es_autor"));}catch(_){es=false;}}
    const cambio=es!==admin;admin=es;
    if(cambio){await Promise.all([cargarEntradas(),cargarPrivado()]);authSubs.forEach(f=>f(admin));}
    return es;
  }

  function init(){
    sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    cargarEntradas();cargarAjustes();
    suscribir();
    sb.auth.onAuthStateChange((evento,session)=>{
      if(evento==="PASSWORD_RECOVERY"){setTimeout(()=>abrirNuevaPwd(),300);}
      // Fuera del callback para no bloquear el cliente de auth
      setTimeout(()=>comprobarAutor(session),0);
    });
    authSubs.forEach(f=>f(false));
  }

  function entradas(){return entradasDb.map(e=>admin&&notas[e.id]?{...e,notas:notas[e.id]}:e);}

  /* Guarda UNA entrada. Devuelve el id (nuevo o existente). */
  async function guardarEntrada(e){
    const fila=aDb(e);
    let id=e.id!=null&&Number.isFinite(Number(e.id))?Number(e.id):null;
    if(id!=null)await escribir(f=>sb.from("entradas").update(f).eq("id",id),fila);
    else id=(await escribir(f=>sb.from("entradas").insert(f).select("id").single(),fila)).id;
    const nt=(e.notas||"").trim();
    if(nt)ok(await sb.from("notas_privadas").upsert({entrada_id:id,texto:nt}));
    else if(notas[id])ok(await sb.from("notas_privadas").delete().eq("entrada_id",id));
    await Promise.all([cargarEntradas(),cargarPrivado()]);
    return id;
  }
  async function actualizarCampos(id,campos){await escribir(f=>sb.from("entradas").update(f).eq("id",id),aDb(campos));recargar("e",cargarEntradas);}
  async function eliminarEntrada(id){ok(await sb.from("entradas").delete().eq("id",id));await cargarEntradas();}
  async function guardarTarea(t){
    const fila={titulo:t.titulo,detalles:t.detalles||"",estado:t.estado,fecha:/^\d{4}-\d{2}-\d{2}$/.test(t.fecha||"")?t.fecha:null};
    if(t.id!=null)ok(await sb.from("tareas").update(fila).eq("id",t.id));
    else ok(await sb.from("tareas").insert(fila));
    await cargarPrivado();
  }
  async function eliminarTarea(id){ok(await sb.from("tareas").delete().eq("id",id));await cargarPrivado();}
  async function actualizarTarea(id,c){ok(await sb.from("tareas").update(c).eq("id",id));await cargarPrivado();}
  async function login(email,pwd){const{error}=await sb.auth.signInWithPassword({email,password:pwd});if(error)throw error;const{data}=await sb.auth.getSession();if(!(await comprobarAutor(data.session))){await sb.auth.signOut();const e=new Error("no-autor");e.code="no-autor";throw e;}}
  async function logout(){await sb.auth.signOut();await comprobarAutor(null);try{if(window.caches)await caches.delete("ensu-datos");}catch(_){}}
  async function guardarAjuste(clave,valor){ok(await sb.from("ajustes").upsert({clave,valor}));await cargarAjustes();}
  /* Sube una imagen (ya comprimida) al bucket "portadas" y devuelve su URL pública. */
  async function subirPortada(blob,id){
    const ruta=`e${id||"nueva"}-${Date.now()}.jpg`;
    ok(await sb.storage.from("portadas").upload(ruta,blob,{contentType:"image/jpeg",upsert:false,cacheControl:"31536000"}));
    return sb.storage.from("portadas").getPublicUrl(ruta).data.publicUrl;
  }
  async function resetPassword(email){const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;}
  async function nuevaPassword(pwd){const{error}=await sb.auth.updateUser({password:pwd});if(error)throw error;}
  function copia(){return{exportado:new Date().toISOString(),origen:"supabase",entradas:entradasDb,notas,tareas,ajustes,historial};}

  return{init,entradas,guardarEntrada,actualizarCampos,eliminarEntrada,
    tareas:()=>tareas,guardarTarea,eliminarTarea,actualizarTarea,
    login,logout,resetPassword,nuevaPassword,copia,
    ajustes:()=>ajustes,guardarAjuste,historial:()=>historial,subirPortada,
    isAdmin:()=>admin,cargado:()=>cargado,errorCarga:()=>errorCarga,
    onChange:f=>subs.add(f),onAuth:f=>authSubs.add(f)};
})();

/* ══ 4. PORTADAS ══
   Orden: URL manual (campo "portada") → id de Open Library guardado → búsqueda
   en Open Library (cacheada) → portada tipográfica generada. */
const Portadas=(()=>{
  const LS="ensu-portadas-v2";
  let cache={};try{cache=JSON.parse(localStorage.getItem(LS)||"{}");}catch(_){}
  const enCurso=new Set();let activas=0;const cola=[];
  const clave=e=>norma(`${e.libro}|${e.autor}`);
  const guardarCache=()=>{try{localStorage.setItem(LS,JSON.stringify(cache));}catch(_){}};
  function url(e,tam){
    if(e.portada)return e.portada;
    const id=e.portadaId>0?e.portadaId:(cache[clave(e)]>0?cache[clave(e)]:0);
    return id?`https://covers.openlibrary.org/b/id/${id}-${tam}.jpg?default=false`:"";
  }
  function conocida(e){return!!e.portada||e.portadaId!==0||cache[clave(e)]!==undefined;}
  function html(e,tam="M",extra=""){
    const tono=COVER_TONOS[hash(e.libro||e.tituloRef)%COVER_TONOS.length];
    const u=e.tipo==="libro"?url(e,tam):"";
    const k=esc(clave(e));
    const tit=e.libro||e.tituloRef||"Sin título";
    const k2=tit.length>40?.72:tit.length>22?.85:1;
    return`<div class="cover${u?" tiene-img":""}" data-ck="${k}" data-id="${e.id}" style="background:${tono}">${extra}
      <div class="cover-gen" style="--cg-k:${k2}"><div><div class="cg-t">${esc(tit)}</div><div class="cg-rule"></div></div><div class="cg-a">${esc(e.autor||"")}</div></div>
      ${u?`<img src="${esc(u)}" alt=""${cargadas.has(u)?` class="ok"`:` loading="lazy"`} onload="Portadas.ok(this)" onerror="Portadas.fallo(this)">`:""}
    </div>`;
  }
  const cargadas=new Set();
  function ok(img){img.classList.add("ok");cargadas.add(img.getAttribute("src"));}
  function fallo(img){const c=img.closest(".cover");if(c)c.classList.remove("tiene-img");img.remove();}
  function pedir(e){
    if(e.tipo!=="libro"||conocida(e)||!e.libro)return;
    const k=clave(e);if(enCurso.has(k))return;
    enCurso.add(k);cola.push(e);bombear();
  }
  function bombear(){
    while(activas<3&&cola.length){
      const e=cola.shift();activas++;
      buscar(e).then(id=>{
        cache[clave(e)]=id;guardarCache();
        if(id>0)pintar(clave(e),id);
        const actual=Store.isAdmin()&&Store.entradas().find(x=>x.id===e.id);
        const editando=Form.id===e.id&&$("form-overlay").classList.contains("open");
        if(actual&&actual.tipo==="libro"&&actual.portadaId===0&&!actual.portada&&!editando)Store.actualizarCampos(e.id,{portadaId:id}).catch(()=>{});
      }).catch(()=>{}).finally(()=>{activas--;enCurso.delete(clave(e));bombear();});
    }
  }
  /* Open Library: primero título + apellido; si no hay nada, solo título.
     Luego se miran las ediciones de las 2 obras más probables (ahí están las
     portadas en español) y se prioriza la que tenga exactamente el mismo título. */
  const apellido=a=>{const p=String(a||"").replace(/(.*?)/g,"").replace(/s(y|&|and)s.*$/i,"").trim().split(/s+/);return p[p.length-1]||"";};
  async function olBuscar(q){
    const r=await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8&fields=key,title,cover_i,language`);
    if(!r.ok)throw new Error("ol");return(await r.json()).docs||[];
  }
  async function olEdiciones(key){
    try{const r=await fetch(`https://openlibrary.org${key}/editions.json?limit=60`);if(!r.ok)return[];
      return((await r.json()).entries||[]).filter(x=>x.covers&&x.covers[0]>0).map(x=>({id:x.covers[0],titulo:x.title||"",es:(x.languages||[]).some(l=>/spa/.test(l.key))}));}
    catch(_){return[];}
  }
  async function candidatos(e){
    let docs=await olBuscar(`${e.libro} ${apellido(e.autor)}`.trim()),conAutor=true;
    if(!docs.length){docs=await olBuscar(e.libro);conAutor=false;}
    const t=norma(e.libro),vistos=new Set(),lista=[];
    // ¿Se parece un título al buscado? (una contiene a la otra o comparten la mitad de las palabras)
    const palabras=x=>norma(x).replace(/[^a-z0-9ñ ]/g," ").split(/\s+/).filter(w=>w.length>2&&!["los","las","del","que","una","the"].includes(w));
    const pt=new Set(palabras(e.libro));
    const parecido=x=>{const n=norma(x);if(!n)return false;if(n.includes(t)||t.includes(n))return true;const w=palabras(x);return w.length&&w.filter(p=>pt.has(p)).length/Math.max(pt.size,1)>=.5;};
    const add=(id,titulo,es)=>{if(id>0&&!vistos.has(id)){vistos.add(id);lista.push({id,titulo,score:(norma(titulo)===t?2:0)+(es?1:0)});}};
    for(const d of docs.slice(0,3)){
      const eds=await olEdiciones(d.key);
      // Las traducciones de la misma obra valen si la obra o alguna edición coincide con el título
      if(parecido(d.title)||eds.some(x=>parecido(x.titulo))){eds.forEach(x=>add(x.id,x.titulo,x.es));add(d.cover_i,d.title,(d.language||[]).includes("spa"));}
    }
    if(conAutor)docs.filter(d=>parecido(d.title)).forEach(d=>add(d.cover_i,d.title,(d.language||[]).includes("spa")));
    lista.sort((x,y)=>y.score-x.score);
    return{lista,conAutor,primera:docs.find(d=>d.cover_i)};
  }
  async function buscar(e){
    const{lista,conAutor,primera}=await candidatos(e);
    if(lista.length&&lista[0].score>=2)return lista[0].id;
    if(conAutor&&primera)return primera.cover_i;
    return -1;
  }
  async function opciones(e){return(await candidatos(e)).lista.slice(0,18);}
  function pintar(k,id){
    $$(`.cover[data-ck="${CSS.escape(k)}"]`).forEach(c=>{
      if(c.querySelector("img"))return;
      const tam=c.closest(".leer-hero")?"L":"M";
      c.classList.add("tiene-img");
      c.insertAdjacentHTML("beforeend",`<img src="https://covers.openlibrary.org/b/id/${id}-${tam}.jpg?default=false" alt="" onload="Portadas.ok(this)" onerror="Portadas.fallo(this)">`);
    });
  }
  function reintentar(e){delete cache[clave(e)];guardarCache();}
  return{html,pedir,fallo,ok,url,reintentar,opciones,clave};
})();
window.Portadas=Portadas;

/* ══ 5. ESTADO DE LA APP, ROUTER Y VISTAS ══ */
const App={
  vista:"home",param:"",leerId:null,leerDesdeApp:false,citaId:null,
  home:{tipo:"Todos",q:"",finalidad:"",categoria:"",estado:"",dificultad:"",desc:true},
  lib:{tab:"todas",tipo:"",categoria:"",q:"",sort:"fecha",dir:-1},
  tareas:{filtro:"todas",sort:"fecha-asc"}
};
const visibles=()=>Store.entradas();
const tipoInfo=t=>TIPOS[t]||TIPOS.libro;
const badgeEstado=e=>e.tipo==="libro"?`<span class="badge b-${e.estado}">${ESTADOS[e.estado]}</span>`:"";
const badgeFin=e=>e.finalidad?`<span class="badge b-${norma(e.finalidad).replace(/\s/g,"")}">${esc(e.finalidad)}</span>`:"";
const titulo=e=>e.tipo==="reflexion"?(e.tituloRef||e.libro):(e.libro||e.tituloRef);
const subtitulo=e=>e.tipo==="reflexion"?(e.libro&&e.libro!==e.tituloRef?e.libro:""):e.tituloRef;

function parseHash(){
  const h=location.hash.replace(/^#\/?/,"");
  const i=h.indexOf("/");
  const v=i<0?h:h.slice(0,i),p=i<0?"":h.slice(i+1);
  let param=p;try{param=decodeURIComponent(p);}catch(_){}
  return{v,p:param};
}
function ir(h){if(location.hash===h)onRoute();else location.hash=h;}
const VISTAS={"":"home",inicio:"home",biblioteca:"biblioteca",cronologia:"cronologia",estadisticas:"estadisticas",tareas:"tareas",etiqueta:"etiqueta",citas:"citas",resumen:"resumen"};
function onRoute(){
  const{v,p}=parseHash();
  if(v==="leer"){abrirLeer(p);return;}
  if(App.leerId!=null)cerrarLeerPanel();
  let vista=VISTAS[v]||"home";
  if(vista==="tareas"&&!Store.isAdmin())vista=Store.cargado()?"home":vista;
  const cambio=vista!==App.vista||p!==App.param;
  App.vista=vista;App.param=p;
  $$(".view").forEach(s=>s.classList.toggle("activa",s.id==="view-"+vista));
  $$("[data-nav]").forEach(b=>b.classList.toggle("activo",b.dataset.nav===vista));
  document.title=({home:"EnSu — Biblioteca personal",biblioteca:"Biblioteca · EnSu",cronologia:"Cronología · EnSu",estadisticas:"Estadísticas · EnSu",tareas:"Tareas · EnSu",etiqueta:`#${p} · EnSu`,citas:"Citas · EnSu",resumen:"Resumen del año · EnSu"})[vista];
  if(cambio)window.scrollTo(0,0);
  renderVista();
}
function renderVista(){
  const f={home:renderHome,biblioteca:renderBiblioteca,cronologia:renderCronologia,estadisticas:renderEstadisticas,tareas:renderTareas,etiqueta:renderEtiqueta,citas:renderCitas,resumen:renderResumen}[App.vista];
  if(f)f();
}

/* ── Tarjetas ── */
function tagsHTML(e,max=4){return e.tags.slice(0,max).map(t=>`<span class="tag" data-act="tag" data-v="${esc(t)}">${esc(t)}</span>`).join("");}
function cardHTML(e){
  const ti=tipoInfo(e.tipo);
  const foot=`<div class="card-foot"><span>${esc(fechaUI(e.fecha))}</span>${e.estado==="leyendo"&&e.tipo==="libro"?`<div class="card-mini-prog" title="${e.progreso}%"><div style="width:${e.progreso}%"></div></div><span>${e.progreso}%</span>`:""}${icon("i-arrow-r","sm")}</div>`;
  const top=`<div class="card-top"><span class="card-type" style="--tc:${ti.c}">${ti.l}</span><div class="card-badges">${badgeFin(e)}${badgeEstado(e)}</div></div>`;
  const privado=e.tipo==="privado"?" card-privado":"";
  if(e.tipo==="libro"){
    Portadas.pedir(e);
    return`<article class="card card-libro" data-act="leer" data-v="${e.id}" tabindex="0">
      ${Portadas.html(e)}
      <div class="card-main">${top}
        <p class="card-autor">${esc(e.autor||"—")}</p>
        <h3 class="card-titulo">${esc(e.libro||e.tituloRef)}</h3>
        ${e.tituloRef?`<p class="card-ref">${esc(e.tituloRef)}</p>`:""}
        <div class="card-tags">${tagsHTML(e,3)}</div>
        ${foot}
      </div></article>`;
  }
  if(e.tipo==="reflexion"){
    return`<article class="card card-reflexion${privado}" data-act="leer" data-v="${e.id}" tabindex="0">
      ${top}<div class="q">“</div>
      <h3 class="card-titulo">${esc(titulo(e))}</h3>
      ${e.reflexion?`<p class="card-extracto">${esc(plano(e.reflexion))}</p>`:""}
      <div class="card-tags">${tagsHTML(e)}</div>${foot}</article>`;
  }
  return`<article class="card card-articulo${privado}" data-act="leer" data-v="${e.id}" tabindex="0" style="${e.tipo==="privado"?"border-left-color:var(--plum)":""}">
    ${top}
    ${e.autor?`<p class="card-autor">${esc(e.autor)}</p>`:""}
    <h3 class="card-titulo">${esc(e.libro||e.tituloRef)}</h3>
    ${e.tituloRef&&e.libro?`<p class="card-ref">${esc(e.tituloRef)}</p>`:""}
    ${e.reflexion?`<p class="card-extracto">${esc(plano(e.reflexion))}</p>`:""}
    <div class="card-tags">${tagsHTML(e)}</div>${foot}</article>`;
}
function estadoCarga(cont,n=6){
  if(Store.errorCarga()){cont.innerHTML=`<div class="empty-state">${icon("i-refresh")}<p>No se pudo conectar con la base de datos.</p><p style="margin-top:12px"><button class="btn-save" data-act="recargar">Reintentar</button></p></div>`;return true;}
  if(!Store.cargado()){cont.innerHTML=Array.from({length:n},()=>`<div class="skel skel-card"></div>`).join("");return true;}
  return false;
}

/* ── HOME ── */
function renderHome(){
  const E=visibles();
  const libros=E.filter(e=>e.tipo==="libro");
  const hs=[
    [libros.filter(e=>e.estado==="terminado").length,"Libros leídos"],
    [libros.filter(e=>e.estado==="leyendo").length,"Leyendo"],
    [E.filter(e=>e.tipo==="reflexion").length,"Reflexiones"],
    [E.filter(e=>e.tipo==="articulo").length,"Artículos"]
  ];
  renderReto();
  $("hero-stats").innerHTML=hs.map(([n,l])=>`<div class="hero-stat"><b>${Store.cargado()?n:"–"}</b><span>${l}</span></div>`).join("");

  // Leyendo ahora
  const ley=libros.filter(e=>e.estado==="leyendo").sort((a,b)=>fechaNum(b)-fechaNum(a));
  $("sec-leyendo").hidden=!ley.length;
  $("leyendo-count").textContent=ley.length;
  $("leyendo-grid").innerHTML=ley.map(e=>{Portadas.pedir(e);return`<article class="ley-card" data-act="leer" data-v="${e.id}" tabindex="0">
    ${Portadas.html(e)}
    <div class="ley-body">
      <p class="ley-autor">${esc(e.autor||"")}</p>
      <h3 class="ley-titulo">${esc(e.libro)}</h3>
      ${e.tituloRef?`<p class="ley-ref">${esc(e.tituloRef)}</p>`:""}
      <div class="ley-prog">
        <div class="prog-meta"><span>${e.paginasTotal?`Página ${e.paginaActual||0} de ${e.paginasTotal}`:"Progreso"}</span><b>${e.progreso}%</b></div>
        <div class="prog-track"><div class="prog-fill" style="width:${e.progreso}%"></div></div>
        <div class="ley-actions admin-only"><button class="chip-btn" data-act="leer-progreso" data-v="${e.id}">${icon("i-edit","sm")} Actualizar progreso</button></div>
      </div>
    </div></article>`;}).join("");

  // Por leer
  const pl=E.filter(e=>POR_LEER.has(e.estado)).sort((a,b)=>(a.orden||999)-(b.orden||999)||fechaNum(a)-fechaNum(b));
  $("sec-porleer").hidden=!pl.length;
  $("porleer-count").textContent=pl.length;
  $("estante").innerHTML=pl.map(e=>{Portadas.pedir(e);return`<div class="estante-item" data-act="leer" data-v="${e.id}" tabindex="0">
    ${Portadas.html(e,"M",e.orden?`<span class="estante-orden">#${e.orden}</span>`:"")}
    <p class="estante-t">${esc(e.libro||e.tituloRef)}</p><p class="estante-a">${esc(e.autor)}</p></div>`;}).join("");

  renderCita();
  renderFiltrosHome();
  renderHomeGrid();
}
function renderCita(forzar){
  const pool=visibles().filter(e=>e.cita.trim());
  if(!pool.length){$("sec-cita").hidden=true;return;}
  let e=pool.find(x=>x.id===App.citaId);
  if(!e||forzar){const otras=pool.length>1?pool.filter(x=>x.id!==App.citaId):pool;e=otras[Math.floor(Math.random()*otras.length)];App.citaId=e.id;}
  $("sec-cita").hidden=false;
  $("quote-text").textContent=e.cita;
  const src=$("quote-source");
  src.textContent=[e.libro||e.tituloRef,e.autor].filter(Boolean).join(" — ");
  src.dataset.v=e.id;
}
function filtrosHome(E){
  const F=App.home;
  const q=norma(F.q);
  const hayFiltro=q||F.finalidad||F.categoria||F.estado||F.dificultad;
  return E.filter(e=>{
    if(POR_LEER.has(e.estado))return false;
    if(!hayFiltro&&e.tipo==="libro"&&e.estado==="leyendo")return false; // ya aparecen en "Leyendo ahora"
    if(F.tipo!=="Todos"&&e.tipo!==F.tipo)return false;
    if(F.finalidad&&e.finalidad!==F.finalidad)return false;
    if(F.categoria&&e.categoria!==F.categoria)return false;
    if(F.estado&&!(e.tipo==="libro"&&e.estado===F.estado))return false;
    if(F.dificultad&&e.dificultad!==F.dificultad)return false;
    if(q&&!norma([e.libro,e.autor,e.tituloRef,e.reflexion,e.vida,e.tension,e.cita,e.categoria,...e.tags].join(" ")).includes(q))return false;
    return true;
  }).sort((a,b)=>F.desc?fechaNum(b)-fechaNum(a):fechaNum(a)-fechaNum(b));
}
function renderHomeGrid(){
  const grid=$("cards-grid"),F=App.home;
  $("sort-btn").innerHTML=`${icon("i-sort","sm")} ${F.desc?"Más recientes":"Más antiguos"}`;
  if(estadoCarga(grid)){$("btn-filtrar").innerHTML=`${icon("i-filter","sm")} Filtros`;return;}
  const E=visibles();
  // pills de tipo con recuento
  const base=E.filter(e=>!POR_LEER.has(e.estado));
  const tipos=["Todos",...["libro","articulo","reflexion","privado"].filter(t=>base.some(e=>e.tipo===t))];
  if(!tipos.includes(F.tipo))F.tipo="Todos";
  $("pills-tipo").innerHTML=tipos.map(t=>{const n=t==="Todos"?base.length:base.filter(e=>e.tipo===t).length;return`<button class="pill${t===F.tipo?" activo":""}" data-act="home-tipo" data-v="${t}">${t==="Todos"?"Todo":TIPOS[t].pl}<span class="n">${n}</span></button>`;}).join("");
  const nf=[F.finalidad,F.categoria,F.estado,F.dificultad].filter(Boolean).length;
  $("btn-filtrar").innerHTML=`${icon("i-filter","sm")} Filtros${nf?` · ${nf}`:""}`;
  $("btn-filtrar").classList.toggle("activo",nf>0);
  $("btn-limpiar").hidden=!nf;
  const lista=filtrosHome(E);
  const hayFiltro=F.q||nf||F.tipo!=="Todos";
  $("result-line").textContent=hayFiltro?`${lista.length} ${lista.length===1?"resultado":"resultados"}`:"";
  $("result-line").hidden=!hayFiltro;
  grid.innerHTML=lista.length?lista.map(cardHTML).join("")
    :`<div class="empty-state">${icon(hayFiltro?"i-search":"i-book")}<p>${F.q?`No hay resultados para «${esc(F.q)}».`:hayFiltro?"No hay entradas con estos filtros.":"Todavía no hay entradas."}</p>${hayFiltro?`<p style="margin-top:12px"><button class="btn-link" data-act="home-reset">Quitar filtros</button></p>`:""}</div>`;
}
function llenarSelect(sel,opciones,placeholder,valor){
  sel.innerHTML=`<option value="">${placeholder}</option>`+opciones.map(o=>`<option value="${esc(o)}"${o===valor?" selected":""}>${esc(o)}</option>`).join("");
  sel.classList.toggle("activo",!!valor);
}
function opcionesDe(campo,base){const s=new Set(base);visibles().forEach(e=>{if(e[campo])s.add(e[campo]);});return[...s];}
function renderFiltrosHome(){
  const F=App.home;
  llenarSelect($("f-home-finalidad"),opcionesDe("finalidad",FINALIDADES),"Finalidad",F.finalidad);
  llenarSelect($("f-home-categoria"),opcionesDe("categoria",CATEGORIAS),"Categoría",F.categoria);
  llenarSelect($("f-home-estado"),["leyendo","terminado"],"Estado del libro",F.estado);
  $("f-home-estado").innerHTML=`<option value="">Estado del libro</option><option value="leyendo"${F.estado==="leyendo"?" selected":""}>Leyendo</option><option value="terminado"${F.estado==="terminado"?" selected":""}>Terminado</option>`;
  llenarSelect($("f-home-dificultad"),opcionesDe("dificultad",DIFICULTADES),"Dificultad",F.dificultad);
}

/* ── BIBLIOTECA ── */
function renderBiblioteca(){
  const L=App.lib,E=visibles();
  const cont=$("lib-list");
  llenarSelect($("f-lib-tipo"),[],"Todos los tipos","");
  $("f-lib-tipo").innerHTML=`<option value="">Todos los tipos</option>`+Object.keys(TIPOS).filter(t=>t!=="privado"||Store.isAdmin()).map(t=>`<option value="${t}"${L.tipo===t?" selected":""}>${TIPOS[t].pl}</option>`).join("");
  $("f-lib-tipo").classList.toggle("activo",!!L.tipo);
  llenarSelect($("f-lib-categoria"),opcionesDe("categoria",CATEGORIAS),"Todas las categorías",L.categoria);
  const libros=E.filter(e=>e.tipo==="libro");
  $("lib-stats").innerHTML=[
    [E.length,"entradas"],[libros.filter(e=>e.estado==="terminado").length,"libros leídos"],
    [E.filter(e=>e.tipo==="articulo").length,"artículos"],[E.filter(e=>e.tipo==="reflexion").length,"reflexiones"]
  ].map(([n,l])=>`<span class="stat-chip"><b>${Store.cargado()?n:"–"}</b> ${l}</span>`).join("");
  const TABS=[["todas","Todo",()=>true],["leyendo","Leyendo",e=>e.estado==="leyendo"&&e.tipo==="libro"],["terminado","Terminados",e=>e.estado==="terminado"||e.tipo!=="libro"],["porleer","Por leer",e=>POR_LEER.has(e.estado)]];
  const tabBase=E.filter(e=>(!L.tipo||e.tipo===L.tipo)&&(!L.categoria||e.categoria===L.categoria));
  $("lib-tabs").innerHTML=TABS.map(([k,l,f])=>`<button class="tab${L.tab===k?" activo":""}" data-act="lib-tab" data-v="${k}">${l}<span class="n">${tabBase.filter(f).length}</span></button>`).join("");
  if(Store.errorCarga()||!Store.cargado()){if(!estadoCarga(cont,4)){}cont.classList.add("sin-borde");return;}
  cont.classList.remove("sin-borde");
  const q=norma(L.q);
  const tabF=TABS.find(t=>t[0]===L.tab)[2];
  const val={titulo:e=>norma(titulo(e)),autor:e=>norma(e.autor),estado:e=>e.tipo==="libro"?Object.keys(ESTADOS).indexOf(e.estado):9,
    dificultad:e=>DIFICULTADES.indexOf(e.dificultad),puntuacion:e=>e.puntuacion||0,fecha:fechaNum};
  const lista=tabBase.filter(tabF).filter(e=>!q||norma([e.libro,e.autor,e.tituloRef,e.categoria,...e.tags].join(" ")).includes(q))
    .sort((a,b)=>{const va=val[L.sort](a),vb=val[L.sort](b);return(va<vb?-1:va>vb?1:0)*L.dir||fechaNum(b)-fechaNum(a);});
  $("lib-count").textContent=`${lista.length} ${lista.length===1?"entrada":"entradas"}`;
  const cols=[["titulo","Título"],["autor","Autor"],["estado","Estado"],["dificultad","Dificultad"],["puntuacion","Nota"]];
  const head=`<div class="lib-head"><span></span>${cols.map(([k,l])=>`<button class="${L.sort===k?"activo":""}" data-act="lib-sort" data-v="${k}">${l}${L.sort===k?(L.dir>0?" ↑":" ↓"):""}</button>`).join("")}<button class="${L.sort==="fecha"?"activo":""}" data-act="lib-sort" data-v="fecha">${L.sort==="fecha"?(L.dir>0?"Fecha ↑":"Fecha ↓"):"Fecha"}</button><span class="admin-only"></span></div>`;
  if(!lista.length){cont.innerHTML=head+`<div class="empty-state">${icon("i-search")}<p>No hay entradas.</p></div>`;return;}
  cont.innerHTML=head+lista.map(e=>{
    const ti=tipoInfo(e.tipo);
    if(e.tipo==="libro")Portadas.pedir(e);
    const vis=e.tipo==="libro"?Portadas.html(e):`<div class="lib-ico" style="--tc:${ti.c}">${icon(ti.i)}</div>`;
    return`<div class="lib-row" data-act="leer" data-v="${e.id}" tabindex="0">
      ${vis}
      <div style="min-width:0"><div class="lib-t">${esc(titulo(e))}</div><div class="lib-r">${esc(subtitulo(e)||ti.l)}<span class="solo-movil">${e.autor?` · ${esc(e.autor)}`:""}${e.fecha?` · ${esc(fechaUI(e.fecha))}`:""}</span></div></div>
      <div class="lib-cell col-autor">${esc(e.autor||"—")}</div>
      <div class="col-estado">${e.tipo==="libro"?badgeEstado(e):`<span class="badge b-${e.tipo==="privado"?"privado":"formacion"}" style="${e.tipo==="privado"?"":"background:var(--surface2);color:var(--text2)"}">${ti.l}</span>`}</div>
      <div class="lib-cell col-dif">${esc(e.dificultad||"—")}</div>
      <div class="lib-cell col-punt">${e.puntuacion?e.puntuacion+"/10":"—"}</div>
      <div class="lib-cell col-fecha">${esc(fechaUI(e.fecha)||"—")}</div>
      <div class="lib-acts admin-only"><button class="btn-icon" data-act="editar" data-v="${e.id}" title="Editar" aria-label="Editar">${icon("i-edit","sm")}</button><button class="btn-icon peligro" data-act="eliminar" data-v="${e.id}" title="Eliminar" aria-label="Eliminar">${icon("i-trash","sm")}</button></div>
    </div>`;}).join("");
}

/* ── CRONOLOGÍA ── (público agrupa por año para no mostrar fechas exactas) */
function renderCronologia(){
  const cont=$("tl-body");
  if(estadoCarga(cont,4))return;
  const admin=Store.isAdmin();
  const lista=visibles().filter(e=>!POR_LEER.has(e.estado)&&e.fecha).sort((a,b)=>fechaNum(b)-fechaNum(a));
  if(!lista.length){cont.innerHTML=`<div class="empty-state">${icon("i-clock")}<p>Sin entradas con fecha.</p></div>`;return;}
  const grupos=new Map();
  lista.forEach(e=>{const[y,m]=e.fecha.split("-");const k=admin?`${y}-${m}`:y;const l=admin?`${MESES[+m-1]} ${y}`:y;if(!grupos.has(k))grupos.set(k,{l,items:[]});grupos.get(k).items.push(e);});
  cont.innerHTML=[...grupos.values()].map(g=>`<div class="tl-group"><div class="tl-mes">${esc(g.l)} · ${g.items.length}</div><div class="tl-items">${g.items.map(e=>{
    const ti=tipoInfo(e.tipo);if(e.tipo==="libro")Portadas.pedir(e);
    return`<div class="tl-item" data-act="leer" data-v="${e.id}" tabindex="0" style="--tc:${ti.c}">
      ${e.tipo==="libro"?Portadas.html(e):`<div class="lib-ico" style="--tc:${ti.c}">${icon(ti.i)}</div>`}
      <div class="tl-body"><p class="tl-tipo">${ti.l}${e.tipo==="libro"?" · "+ESTADOS[e.estado]:""}${admin?" · "+esc(fechaLarga(e.fecha)):""}</p>
      <p class="tl-titulo">${esc(titulo(e))}</p>${subtitulo(e)?`<p class="tl-sub">${esc(subtitulo(e))}</p>`:""}</div>
      ${icon("i-arrow-r","sm")}</div>`;}).join("")}</div></div>`).join("");
}

/* ── ESTADÍSTICAS ── */
function barras(pares){
  const max=Math.max(1,...pares.map(p=>p[1]));
  return pares.map(([l,n,act])=>`<div class="bar-row"${act?` data-act="${act.a}" data-v="${esc(act.v)}" style="cursor:pointer"`:""}><span class="bar-label" title="${esc(l)}">${esc(l)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(n/max*100)}%"></div></div><span class="bar-count">${n}</span></div>`).join("");
}
function renderEstadisticas(){
  const E=visibles();
  if(!Store.cargado()){$("stats-boxes").innerHTML=`<div class="skel" style="height:96px;grid-column:1/-1"></div>`;return;}
  const admin=Store.isAdmin();
  const libros=E.filter(e=>e.tipo==="libro");
  const term=libros.filter(e=>e.estado==="terminado");
  const anio=String(new Date().getFullYear());
  const paginas=libros.reduce((s,e)=>s+(e.estado==="terminado"?(e.paginasTotal||0):(e.paginaActual||0)),0);
  // Racha: meses consecutivos (hasta el actual o el anterior) con alguna entrada
  const mesesCon=new Set(E.filter(e=>e.fecha&&!POR_LEER.has(e.estado)).map(e=>e.fecha.slice(0,7)));
  let racha=0;const d=new Date();d.setDate(1);
  const k=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`;
  if(!mesesCon.has(k(d)))d.setMonth(d.getMonth()-1);
  while(mesesCon.has(k(d))){racha++;d.setMonth(d.getMonth()-1);}
  const cajas=[
    [E.length,"Entradas",""],
    [term.length,"Libros leídos",`${terminadosEn(anio).length} en ${anio}${retoDe(anio)?` de ${retoDe(anio)}`:""}`],
    [libros.filter(e=>e.estado==="leyendo").length,"Leyendo ahora",""],
    [E.filter(e=>POR_LEER.has(e.estado)).length,"Por leer",""],
    [E.filter(e=>e.tipo==="reflexion"||e.tipo==="articulo").length,"Reflexiones y artículos",""]
  ];
  if(paginas)cajas.push([paginas.toLocaleString("es"),"Páginas registradas",""]);
  if(admin)cajas.push([racha,"Racha",racha===1?"mes seguido":"meses seguidos"]);
  $("stats-boxes").innerHTML=cajas.map(([n,l,s])=>`<div class="stat-box"><b>${n}</b><span>${l}</span>${s?`<small>${esc(s)}</small>`:""}</div>`).join("");

  $("stats-resumen").innerHTML=`${icon("i-sparkle")}<span><b>Mi ${anio} en libros</b><small>Tu resumen del año: estantería, favoritos y temas</small></span>${icon("i-arrow-r","sm")}`;
  $("stats-resumen").href="#/resumen/"+anio;
  renderRitmoSemanal();
  // Actividad: autor → mapa mensual (24 meses); público → por año
  const act=$("stats-actividad");
  if(admin){
    $("stats-act-title").textContent="Actividad por mes";
    const cnt={};E.filter(e=>e.fecha&&!POR_LEER.has(e.estado)).forEach(e=>{const kk=e.fecha.slice(0,7);cnt[kk]=(cnt[kk]||0)+1;});
    const y=new Date().getFullYear();
    act.innerHTML=[y-1,y].map(yy=>`<p class="heat-year">${yy}</p><div class="heat">${Array.from({length:12},(_,m)=>{const kk=`${yy}-${String(m+1).padStart(2,"0")}`;const n=cnt[kk]||0;return`<div class="heat-cell" data-n="${Math.min(4,n)}" title="${MESES[m]} ${yy}: ${n}"></div>`;}).join("")}</div><div class="heat-lbls">${MESES_C.map(m=>`<span>${m}</span>`).join("")}</div>`).join("")
      +`<div class="heat-leg">Menos <i></i><i style="background:rgba(196,169,125,.35)"></i><i style="background:rgba(196,169,125,.6)"></i><i style="background:rgba(196,169,125,.85)"></i><i style="background:var(--accent-dk)"></i> Más</div>`;
  }else{
    $("stats-act-title").textContent="Entradas por año";
    const cnt={};E.filter(e=>e.fecha&&!POR_LEER.has(e.estado)).forEach(e=>{const yy=e.fecha.slice(0,4);cnt[yy]=(cnt[yy]||0)+1;});
    act.innerHTML=barras(Object.entries(cnt).sort((a,b)=>b[0].localeCompare(a[0])));
  }
  const cuenta=f=>{const c={};E.forEach(e=>{const v=f(e);if(v)c[v]=(c[v]||0)+1;});return Object.entries(c).sort((a,b)=>b[1]-a[1]);};
  $("stats-categorias").innerHTML=barras(cuenta(e=>e.categoria).slice(0,8))||`<p class="form-hint">Sin datos</p>`;
  $("stats-tipos").innerHTML=barras(["libro","articulo","reflexion"].map(t=>[TIPOS[t].pl,E.filter(e=>e.tipo===t).length]));
  $("stats-autores").innerHTML=barras(cuenta(e=>e.autor).filter(a=>a[1]>1).slice(0,6))||barras(cuenta(e=>e.autor).slice(0,6));
  const tags={};E.forEach(e=>e.tags.forEach(t=>tags[t]=(tags[t]||0)+1));
  $("stats-tags").innerHTML=Object.entries(tags).sort((a,b)=>b[1]-a[1]).slice(0,18).map(([t,n])=>`<span class="tag" data-act="tag" data-v="${esc(t)}">${esc(t)}<span>${n}</span></span>`).join("");
}

/* ── ETIQUETA ── */
function renderEtiqueta(){
  const tag=App.param;
  $("tag-title").textContent="#"+tag;
  const grid=$("tag-grid");
  if(estadoCarga(grid,3))return;
  const lista=visibles().filter(e=>e.tags.includes(tag)).sort((a,b)=>fechaNum(b)-fechaNum(a));
  $("tag-count").textContent=`${lista.length} ${lista.length===1?"entrada":"entradas"}`;
  grid.innerHTML=lista.length?lista.map(cardHTML).join(""):`<div class="empty-state">${icon("i-tag")}<p>Sin entradas con esta etiqueta.</p></div>`;
}

/* ── PANEL DE LECTURA ── */
function abrirLeer(id){
  App.leerId=String(id);
  const panel=$("leer-panel");
  if(!App.leerAbierto){
    App.leerAbierto=true;
    panel.style.display="block";
    requestAnimationFrame(()=>panel.classList.add("open"));
    panel.scrollTop=0;bloquearScroll(true);
  }
  renderLeer(true);
  if(!$$(".view.activa").length){$("view-home").classList.add("activa");renderHome();}
}
function cerrarLeerPanel(){
  const panel=$("leer-panel");
  if(App.leerId==null)return;
  App.leerId=null;
  panel.classList.remove("open");
  setTimeout(()=>{if(App.leerId==null)panel.style.display="none";},250);
  if(App.leerAbierto){App.leerAbierto=false;bloquearScroll(false);}
}
function cerrarLeer(){
  if(App.leerDesdeApp){App.leerDesdeApp=false;history.back();}
  else{history.replaceState(null,"",location.pathname+location.search+(App.vista==="home"?"#/":`#/${Object.keys(VISTAS).find(k=>VISTAS[k]===App.vista&&k)||""}`));onRoute();}
}
function renderLeer(scrollTop){
  const cont=$("leer-content");
  if(App.leerId==null)return;
  if(!Store.cargado()){cont.innerHTML=`<div class="leer-hero"><div class="skel" style="aspect-ratio:2/3"></div><div><div class="skel" style="height:48px;margin-bottom:12px"></div><div class="skel" style="height:20px;width:40%"></div></div></div>`;return;}
  const e=visibles().find(x=>String(x.id)===App.leerId);
  if(!e){cont.innerHTML=`<div class="leer-body"><div class="empty-state">${icon("i-book")}<p>Esta entrada no existe o es privada.</p><p style="margin-top:12px"><button class="btn-save" data-act="cerrar-leer">Volver</button></p></div></div>`;$("leer-rel").innerHTML="";$("leer-admin").hidden=true;return;}
  // No re-renderizar mientras el autor escribe en el widget de progreso
  if(!scrollTop&&cont.contains(document.activeElement)&&document.activeElement.tagName==="INPUT")return;
  const admin=Store.isAdmin(),ti=tipoInfo(e.tipo),esLibro=e.tipo==="libro";
  document.title=`${titulo(e)} · EnSu`;
  $("leer-admin").hidden=!admin;
  if(esLibro)Portadas.pedir(e);
  const quick=admin&&esLibro&&e.estado!=="terminado"?`<div class="leer-quick" id="leer-quick">
      <div class="prog-meta"><span>${e.estado==="leyendo"?"Tu progreso":"Aún no empezado"}</span><b>${e.progreso}%</b></div>
      <div class="prog-track"><div class="prog-fill" style="width:${e.progreso}%"></div></div>
      <div class="leer-quick-row">
        ${e.paginasTotal?`<span>Página</span><input type="number" id="q-val" min="0" max="${e.paginasTotal}" value="${e.paginaActual||0}" inputmode="numeric"><span>de ${e.paginasTotal}</span>`
          :`<input type="number" id="q-val" min="0" max="100" value="${e.progreso}" inputmode="numeric"><span>%</span>`}
        <button class="btn-sm" data-act="q-guardar" data-v="${e.id}">Guardar</button>
      </div>
      <div class="leer-quick-row"><button class="chip-btn" data-act="q-terminado" data-v="${e.id}">${icon("i-check","sm")} Marcar como terminado</button></div>
    </div>`:"";
  const eyebrow=`<div class="leer-eyebrow"><span class="badge" style="background:var(--surface2);color:var(--text2)">${ti.l}</span>${badgeFin(e)}${badgeEstado(e)}</div>`;
  const hero=`<header class="leer-hero${esLibro?"":" sin-portada"}">
      ${esLibro?Portadas.html(e,"L"):""}
      <div>${eyebrow}
        <h1 class="leer-libro">${esc(titulo(e))}</h1>
        ${e.autor||(e.tipo==="reflexion"&&e.libro&&e.libro!==e.tituloRef)?`<p class="leer-autor">${e.autor?`de <b>${esc(e.autor)}</b>`:""}${e.tipo==="reflexion"&&e.libro&&e.libro!==e.tituloRef?`${e.autor?" · ":""}${esc(e.libro)}`:""}</p>`:""}
        ${e.tags.length?`<div class="leer-tags">${e.tags.map(t=>`<span class="tag" data-act="tag" data-v="${esc(t)}">${esc(t)}</span>`).join("")}</div>`:""}
      </div>${quick}</header>`;
  const sec=(lbl,html)=>`<section class="leer-seccion"><p class="leer-sec-lbl">${lbl}</p>${html}</section>`;
  let body="";
  if(e.tipo!=="reflexion"&&e.tituloRef)body+=`<p class="leer-frase">${esc(e.tituloRef)}</p>`;
  if(e.reflexion)body+=sec(e.tipo==="articulo"?"Teoría":"Resumen",`<div class="leer-rich">${txRich(e.reflexion)}</div>`);
  if(e.cita)body+=`<figure class="leer-cita"><span class="leer-cita-mark">“</span><blockquote class="leer-cita-txt">${esc(e.cita)}</blockquote><button class="chip-btn leer-cita-btn" data-act="cita-img" data-v="${e.id}">${icon("i-image","sm")} Compartir como imagen</button></figure>`;
  if(e.tension)body+=sec("Mi análisis",`<div class="leer-rich">${txRich(e.tension)}</div>`);
  if(e.vida)body+=sec("Cómo lo aplico",`<div class="leer-rich">${txRich(e.vida)}</div>`);
  if(admin&&esLibro&&(e.estado==="leyendo"||puntosDe(e).length>=2))body+=sec("Tu ritmo de lectura",ritmoHTML(e));
  if(admin&&e.notas)body+=sec("Notas privadas",`<div class="leer-notas">${esc(e.notas)}</div>`);
  if(!e.reflexion&&!e.vida&&!e.tension&&!e.cita)body+=`<p class="form-hint" style="margin-top:28px">Todavía no hay notas sobre esta lectura.</p>`;
  const ficha=[
    e.fecha&&["Fecha",fechaUI(e.fecha)],
    esLibro&&["Estado",ESTADOS[e.estado]],
    e.paginasTotal&&["Páginas",e.paginaActual!=null&&e.estado!=="terminado"?`${e.paginaActual} / ${e.paginasTotal}`:String(e.paginasTotal)],
    esLibro&&e.estado!=="terminado"&&["Progreso",e.progreso+"%"],
    e.categoria&&["Categoría",e.categoria],
    e.dificultad&&["Dificultad",e.dificultad],
    e.puntuacion&&["Puntuación",`${e.puntuacion} / 10`,e.puntuacion],
    e.orden&&POR_LEER.has(e.estado)&&["Orden en lista","#"+e.orden]
  ].filter(Boolean);
  if(ficha.length)body+=sec("Ficha",`<div class="leer-ficha">${ficha.map(([k,v,p])=>`<div class="ficha-item"><p class="ficha-k">${k}</p><p class="ficha-v">${esc(v)}</p>${p?`<div class="rdots">${Array.from({length:10},(_,i)=>`<i class="${i<p?"on":""}"></i>`).join("")}</div>`:""}</div>`).join("")}</div>`);
  cont.innerHTML=hero+`<div class="leer-body">${body}</div>`;
  // Relacionadas por etiquetas compartidas
  const tags=new Set(e.tags);
  const rel=visibles().filter(x=>x.id!==e.id&&!POR_LEER.has(x.estado)).map(x=>({x,n:x.tags.filter(t=>tags.has(t)).length+(x.categoria&&x.categoria===e.categoria?.5:0)})).filter(r=>r.n>=1).sort((a,b)=>b.n-a.n).slice(0,4).map(r=>r.x);
  $("leer-rel").innerHTML=rel.length?`<p class="leer-sec-lbl">También relacionado</p><div class="rel-grid">${rel.map(r=>{const t=tipoInfo(r.tipo);if(r.tipo==="libro")Portadas.pedir(r);return`<div class="rel-card" data-act="leer" data-v="${r.id}" tabindex="0">${r.tipo==="libro"?Portadas.html(r):`<div class="lib-ico" style="--tc:${t.c}">${icon(t.i)}</div>`}<div style="min-width:0"><p class="rel-tipo">${t.l}</p><p class="rel-titulo">${esc(titulo(r))}</p></div></div>`;}).join("")}</div>`:"";
  if(scrollTop)$("leer-panel").scrollTop=0;
}
async function guardarProgresoRapido(id,terminar){
  const e=visibles().find(x=>String(x.id)===String(id));if(!e)return;
  const c={};
  if(terminar){c.estado="terminado";c.progreso=100;c.terminadoEn=hoyISO();if(e.paginasTotal)c.paginaActual=e.paginasTotal;}
  else{
    const v=parseInt($("q-val").value,10);
    if(!Number.isFinite(v)||v<0){toast("Introduce un número válido.","error");return;}
    if(e.paginasTotal){const pa=Math.min(v,e.paginasTotal);c.paginaActual=pa;c.progreso=Math.round(pa/e.paginasTotal*100);}
    else c.progreso=Math.min(100,v);
    if(c.progreso>=100){c.estado="terminado";c.terminadoEn=hoyISO();}
    else if(c.progreso>0&&POR_LEER.has(e.estado))c.estado="leyendo";
  }
  try{await Store.actualizarCampos(e.id,c);document.activeElement&&document.activeElement.blur();toast(c.estado==="terminado"?"¡Libro terminado! 🎉":"Progreso guardado.");renderLeer();}
  catch(err){toast(errTxt(err),"error");}
}
async function compartir(){
  const e=visibles().find(x=>String(x.id)===App.leerId);
  await compartirEnlace(enlaceEntrada(App.leerId),e?`${titulo(e)} · EnSu`:"EnSu");
}

/* ── Scroll lock (modales y panel) ── */
let _locks=0,_sy=0;
function bloquearScroll(on){
  _locks=Math.max(0,_locks+(on?1:-1));
  const b=document.body;
  if(on&&_locks===1){_sy=window.scrollY;b.style.position="fixed";b.style.top=`-${_sy}px`;b.style.left="0";b.style.right="0";}
  if(!on&&_locks===0){b.style.position="";b.style.top="";b.style.left="";b.style.right="";window.scrollTo(0,_sy);}
}
function abrirModal(id){const o=$(id);if(o.classList.contains("open"))return;o.classList.add("open");bloquearScroll(true);const f=o.querySelector("input:not([type=hidden]),select,textarea");if(f&&window.innerWidth>767)setTimeout(()=>f.focus(),60);}
function cerrarModal(id){const o=$(id);if(!o.classList.contains("open"))return;o.classList.remove("open");bloquearScroll(false);}
function modalAbierto(){return $$(".modal-overlay.open").pop();}

/* ══ 6. FORMULARIO DE ENTRADA (wizard) ══ */
const Form={id:null,paso:0};
const CAMPOS=["tipo","estado","libro","autor","fecha","paginasTotal","paginaActual","progreso","finalidad","categoria","dificultad","puntuacion","orden","tags","portada","portadaId","terminadoEn","tituloRef","reflexion","cita","vida","tension","notas"];
const fEl=k=>$("f-"+k);
function prepararSelectsForm(){
  llenarSelect(fEl("finalidad"),opcionesDe("finalidad",FINALIDADES),"—","");
  llenarSelect(fEl("categoria"),opcionesDe("categoria",CATEGORIAS),"—","");
  fEl("dificultad").innerHTML=`<option value="">—</option>`+opcionesDe("dificultad",DIFICULTADES).map(d=>`<option>${esc(d)}</option>`).join("");
  $("dl-libros").innerHTML=[...new Set(visibles().map(e=>e.libro).filter(Boolean))].map(v=>`<option value="${esc(v)}">`).join("");
  $("dl-autores").innerHTML=[...new Set(visibles().map(e=>e.autor).filter(Boolean))].map(v=>`<option value="${esc(v)}">`).join("");
}
function abrirForm(id){
  if(!Store.isAdmin()){abrirLogin();return;}
  prepararSelectsForm();
  limpiarErrores();
  $("libro-form").reset();
  fEl("portadaId").value="";$("cover-opciones").hidden=true;$("cover-opciones").innerHTML="";
  Form.id=id!=null?Number(id):null;
  const e=Form.id!=null?visibles().find(x=>x.id===Form.id):null;
  if(Form.id!=null&&!e){toast("No se encontró la entrada.","error");return;}
  $("form-title").textContent=e?"Editar entrada":"Nueva entrada";
  $("form-sub").textContent=e?titulo(e):"Registra lo que esta lectura despertó en ti.";
  if(e){
    CAMPOS.forEach(k=>{const el=fEl(k);if(!el)return;const v=e[k];el.value=k==="tags"?e.tags.join(", "):(v==null?"":v);});
    $("draft-banner").hidden=true;
  }else{
    fEl("fecha").value=hoyISO();fEl("estado").value="leyendo";fEl("progreso").value=0;
    $("draft-banner").hidden=!cargarBorrador();
  }
  $("form-del").hidden=!e;
  syncProgreso();syncTipo();actualizarPreviewPortada();
  irPaso(0);
  abrirModal("form-overlay");
}
function syncTipo(){
  const t=fEl("tipo").value,libro=t==="libro";
  $$(".solo-libro").forEach(el=>el.hidden=!libro);
  $("row-terminado").hidden=!(libro&&fEl("estado").value==="terminado");
  $("lbl-libro").textContent=t==="articulo"?"Título del artículo o fuente":t==="reflexion"?"Fuente o inspiración (opcional)":"Título del libro";
  $("lbl-ref").innerHTML=t==="reflexion"?`Título de la reflexión <small>(obligatorio)</small>`:"Idea central en una frase";
}
function syncProgreso(){
  const total=parseInt(fEl("paginasTotal").value,10),act=parseInt(fEl("paginaActual").value,10);
  const r=fEl("progreso"),auto=total>0;
  if(auto){r.value=Math.min(100,Math.round((Number.isFinite(act)?act:0)/total*100));}
  if(fEl("estado").value==="terminado"&&!auto)r.value=100;
  r.disabled=auto||fEl("estado").value==="terminado";
  $("progreso-val").textContent=r.value+"%";
  $("progreso-auto").hidden=!auto;
}
function actualizarPreviewPortada(){
  const e={tipo:"libro",libro:fEl("libro").value||"Título",autor:fEl("autor").value,portada:fEl("portada").value.trim(),portadaId:Number(fEl("portadaId").value)||0,id:0};
  $("cover-prev").innerHTML=Portadas.html(e);
}
function irPaso(n){
  Form.paso=n;
  $$(".wiz-page").forEach((p,i)=>p.classList.toggle("activo",i===n));
  $$(".wiz-step").forEach((s,i)=>{s.classList.toggle("activo",i===n);s.classList.toggle("hecho",i<n);});
  $("wiz-hint").textContent=`Paso ${n+1} de 3`;
  $("wiz-prev").hidden=n===0;$("wiz-next").hidden=n===2;$("wiz-submit").hidden=n!==2;
  $("form-body").scrollTop=0;
}
function limpiarErrores(){$$("#libro-form .invalido").forEach(el=>el.classList.remove("invalido"));$$("#libro-form .field-err").forEach(el=>el.classList.remove("visible"));$$(".wiz-step").forEach(s=>s.classList.remove("con-error"));$("form-alert").classList.remove("visible");}
function marcarError(k,msg){const el=fEl(k);el.classList.add("invalido");const m=$("err-"+k);if(m){m.textContent=msg;m.classList.add("visible");}}
/* Devuelve el primer paso con errores o -1. */
function validar(){
  limpiarErrores();
  const t=fEl("tipo").value;const errs=[];
  if(t!=="reflexion"&&!fEl("libro").value.trim()){marcarError("libro","Escribe el título.");errs.push(0);}
  const pt=fEl("paginasTotal").value,pa=fEl("paginaActual").value;
  if(pt&&!(+pt>0)){marcarError("paginasTotal","Debe ser mayor que 0.");errs.push(0);}
  if(pa&&(+pa<0||(pt&&+pa>+pt))){marcarError("paginaActual","No puede superar el total de páginas.");errs.push(0);}
  const p=fEl("puntuacion").value;if(p&&(+p<1||+p>10)){marcarError("puntuacion","Entre 1 y 10.");errs.push(0);}
  const u=fEl("portada").value.trim();if(u&&!/^https:\/\//i.test(u)){marcarError("portada","Debe ser un enlace https://");errs.push(0);}
  if(t==="reflexion"&&!fEl("tituloRef").value.trim()){marcarError("tituloRef","Una reflexión necesita un título.");errs.push(1);}
  errs.forEach(i=>$$(".wiz-step")[i].classList.add("con-error"));
  return errs.length?Math.min(...errs):-1;
}
function siguiente(){
  const paso=validar();
  if(paso!==-1&&paso<=Form.paso){irPaso(paso);return;}
  limpiarErrores();irPaso(Math.min(2,Form.paso+1));
}
async function guardarForm(ev){
  ev.preventDefault();
  const paso=validar();
  if(paso!==-1){irPaso(paso);$("form-alert").textContent="Revisa los campos marcados en rojo.";$("form-alert").classList.add("visible");return;}
  const v=k=>fEl(k).value.trim();
  const num=k=>{const x=v(k);return x===""?null:Number(x);};
  const estado=v("estado"),total=num("paginasTotal");
  let paginaActual=num("paginaActual");
  let progreso=parseInt(fEl("progreso").value,10)||0;
  if(estado==="terminado"){progreso=100;if(total)paginaActual=total;}
  else if(total)progreso=Math.min(100,Math.round((paginaActual||0)/total*100));
  const previa=Form.id!=null?visibles().find(x=>x.id===Form.id):null;
  const datos={
    ...(previa||{}),
    id:Form.id!=null?Form.id:null,
    tipo:v("tipo"),estado,libro:v("libro"),autor:v("autor"),fecha:v("fecha"),
    paginasTotal:total,paginaActual,progreso,
    finalidad:v("finalidad"),categoria:v("categoria"),dificultad:v("dificultad"),
    puntuacion:num("puntuacion"),orden:num("orden"),
    tags:v("tags").split(",").map(t=>t.trim()).filter(Boolean),
    portada:v("portada"),portadaId:Number(v("portadaId"))||0,
    terminadoEn:estado==="terminado"?(v("terminadoEn")||(previa&&previa.estado==="terminado"?"":hoyISO())):"",
    tituloRef:v("tituloRef"),reflexion:fEl("reflexion").value.trim(),cita:v("cita"),
    vida:fEl("vida").value.trim(),tension:fEl("tension").value.trim(),notas:fEl("notas").value
  };
  // Si cambia el título/autor, la portada automática se vuelve a buscar
  if(previa&&(previa.libro!==datos.libro||previa.autor!==datos.autor)&&!datos.portada&&datos.portadaId===previa.portadaId){datos.portadaId=0;Portadas.reintentar(datos);}
  const btn=$("wiz-submit");btn.disabled=true;
  try{
    await Store.guardarEntrada(datos);
    borrarBorrador();
    cerrarModal("form-overlay");
    toast(previa?"Entrada actualizada.":"Entrada guardada.");
  }catch(err){toast(errTxt(err),"error");}
  finally{btn.disabled=false;}
}
async function eliminarEntrada(id){
  const e=visibles().find(x=>String(x.id)===String(id));if(!e)return;
  if(!confirm(`¿Eliminar «${titulo(e)}»? Esta acción no se puede deshacer.`))return;
  try{
    await Store.eliminarEntrada(e.id);
    toast("Entrada eliminada.");
    if(App.leerId!=null&&String(App.leerId)===String(e.id))cerrarLeer();
    cerrarModal("form-overlay");
  }catch(err){toast(errTxt(err),"error");}
}
/* Borrador local (solo entradas nuevas) */
const DRAFT="ensu-borrador";
function guardarBorrador(){if(Form.id!=null)return;const d={};CAMPOS.forEach(k=>{const el=fEl(k);if(el)d[k]=el.value;});try{localStorage.setItem(DRAFT,JSON.stringify(d));}catch(_){}}
function cargarBorrador(){try{const d=JSON.parse(localStorage.getItem(DRAFT)||"null");return d&&(d.libro||d.reflexion||d.tituloRef)?d:null;}catch(_){return null;}}
function restaurarBorrador(){const d=cargarBorrador();if(!d)return;CAMPOS.forEach(k=>{const el=fEl(k);if(el&&d[k]!=null)el.value=d[k];});syncTipo();syncProgreso();actualizarPreviewPortada();$("draft-banner").hidden=true;}
function borrarBorrador(){try{localStorage.removeItem(DRAFT);}catch(_){}$("draft-banner").hidden=true;}

/* ══ LOGIN ══ */
function abrirLogin(){
  const admin=Store.isAdmin();
  $("login-section").hidden=admin;$("logout-section").hidden=!admin;
  $("login-error").classList.remove("visible");$("login-pwd").value="";
  abrirModal("login-overlay");
}
async function hacerLogin(){
  const email=$("login-email").value.trim(),pwd=$("login-pwd").value,btn=$("login-btn"),er=$("login-error");
  er.classList.remove("visible");
  if(!email||!pwd){er.textContent="Escribe tu email y contraseña.";er.classList.add("visible");return;}
  btn.disabled=true;
  try{await Store.login(email,pwd);cerrarModal("login-overlay");toast("Modo edición activado.");}
  catch(err){
    const c=err?`${err.code||""} ${err.message||""} ${err.status||""}`:"";
    er.textContent=/no-autor/.test(c)?"Esta cuenta no tiene permisos de autor.":/429|rate|too many/i.test(c)?"Demasiados intentos. Espera unos minutos.":/not confirmed/i.test(c)?"Confirma tu email antes de entrar.":/fetch|network/i.test(c)?"Sin conexión.":"Email o contraseña incorrectos.";
    er.classList.add("visible");
  }finally{btn.disabled=false;}
}
async function recuperarPwd(){
  const email=$("login-email").value.trim(),er=$("login-error");
  if(!email){er.textContent="Escribe tu email y pulsa de nuevo «¿Olvidaste la contraseña?».";er.classList.add("visible");$("login-email").focus();return;}
  try{await Store.resetPassword(email);er.classList.remove("visible");toast("Te hemos enviado un email para cambiar la contraseña.");}
  catch(_){er.textContent="No se pudo enviar el email. Revisa la dirección.";er.classList.add("visible");}
}
function abrirNuevaPwd(){$("pwd-nueva").value="";$("pwd-nueva2").value="";$("pwd-error").classList.remove("visible");abrirModal("pwd-overlay");}
async function guardarNuevaPwd(){
  const p1=$("pwd-nueva").value,p2=$("pwd-nueva2").value,er=$("pwd-error"),btn=$("pwd-btn");
  er.classList.remove("visible");
  if(p1.length<8){er.textContent="Usa al menos 8 caracteres.";er.classList.add("visible");return;}
  if(p1!==p2){er.textContent="Las contraseñas no coinciden.";er.classList.add("visible");return;}
  btn.disabled=true;
  try{await Store.nuevaPassword(p1);cerrarModal("pwd-overlay");toast("Contraseña actualizada.");}
  catch(_){er.textContent="No se pudo cambiar. Pide un enlace nuevo.";er.classList.add("visible");}
  finally{btn.disabled=false;}
}
async function hacerLogout(){await Store.logout();cerrarModal("login-overlay");cerrarModal("mas-overlay");toast("Sesión cerrada.");if(App.vista==="tareas")ir("#/");}

/* ══ TAREAS ══ */
function renderTareas(){
  if(!Store.isAdmin()){$("kanban").innerHTML=`<div class="empty-state">${icon("i-lock")}<p>Inicia sesión para ver tus tareas.</p></div>`;return;}
  const T=Store.tareas(),F=App.tareas;
  const est=[["todas","Total"],["pendiente","Pendiente"],["en-progreso","En progreso"],["completado","Completado"]];
  $("tareas-stats").innerHTML=est.map(([k,l])=>`<button class="tstat${F.filtro===k?" activa":""}" data-act="t-filtro" data-v="${k}"><b>${k==="todas"?T.length:T.filter(t=>t.estado===k).length}</b><span>${l}</span></button>`).join("");
  const ord=l=>l.slice().sort((a,b)=>{const s=F.sort;if(s==="fecha-asc")return(a.fecha||"9")<(b.fecha||"9")?-1:1;if(s==="fecha-desc")return(a.fecha||"")>(b.fecha||"")?-1:1;return s==="titulo-az"?a.titulo.localeCompare(b.titulo,"es"):b.titulo.localeCompare(a.titulo,"es");});
  const PREV={"en-progreso":"pendiente","completado":"en-progreso"},NEXT={"pendiente":"en-progreso","en-progreso":"completado"};
  const cols=[["pendiente","Pendiente"],["en-progreso","En progreso"],["completado","Completado"]].filter(([k])=>F.filtro==="todas"||F.filtro===k);
  $("kanban").className="kanban"+(F.filtro!=="todas"?" filtrado":"");
  $("kanban").innerHTML=cols.map(([k,l])=>{const lista=ord(T.filter(t=>t.estado===k));return`<div class="kcol"><div class="kcol-h">${l}<span class="n">${lista.length}</span></div><div class="kcol-b">${lista.length?lista.map(t=>`
    <div class="tarea${k==="completado"?" done":""}">
      <div class="tarea-t">${esc(t.titulo)}</div>
      ${t.detalles?`<div class="tarea-d">${esc(t.detalles)}</div>`:""}
      <div class="tarea-f"><span class="tarea-fecha">${t.fecha?esc(fechaLarga(t.fecha)):""}</span><div class="tarea-acts">
        ${PREV[k]?`<button class="btn-icon" data-act="t-mover" data-v="${t.id}" data-e="${PREV[k]}" title="Retroceder" aria-label="Retroceder">${icon("i-arrow-l","sm")}</button>`:""}
        ${NEXT[k]?`<button class="btn-icon" data-act="t-mover" data-v="${t.id}" data-e="${NEXT[k]}" title="Avanzar" aria-label="Avanzar">${icon("i-arrow-r","sm")}</button>`:""}
        <button class="btn-icon" data-act="t-editar" data-v="${t.id}" title="Editar" aria-label="Editar">${icon("i-edit","sm")}</button>
        <button class="btn-icon peligro" data-act="t-eliminar" data-v="${t.id}" title="Eliminar" aria-label="Eliminar">${icon("i-trash","sm")}</button>
      </div></div></div>`).join(""):`<p class="kempty">Sin tareas</p>`}</div></div>`;}).join("");
}
let _tareaId=null;
function abrirTarea(id){
  const t=id!=null?Store.tareas().find(x=>x.id===Number(id)):null;
  _tareaId=t?t.id:null;
  $("tarea-title").textContent=t?"Editar tarea":"Nueva tarea";
  $("t-titulo").value=t?t.titulo:"";$("t-detalles").value=t?t.detalles:"";
  $("t-estado").value=t?t.estado:"pendiente";$("t-fecha").value=t?t.fecha:"";
  $("t-titulo").classList.remove("invalido");$("err-t-titulo").classList.remove("visible");
  abrirModal("tarea-overlay");
}
async function guardarTarea(){
  const titulo=$("t-titulo").value.trim();
  if(!titulo){$("t-titulo").classList.add("invalido");$("err-t-titulo").classList.add("visible");$("t-titulo").focus();return;}
  const btn=$("t-guardar");btn.disabled=true;
  const datos={id:_tareaId,titulo,detalles:$("t-detalles").value.trim(),estado:$("t-estado").value,fecha:$("t-fecha").value};
  try{await Store.guardarTarea(datos);cerrarModal("tarea-overlay");toast(_tareaId!=null?"Tarea actualizada.":"Tarea creada.");}
  catch(err){toast(errTxt(err),"error");}finally{btn.disabled=false;}
}

/* ══ COPIA DE SEGURIDAD ══ */
function descargarCopia(){
  const blob=new Blob([JSON.stringify(Store.copia(),null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`ensu-copia-${hoyISO()}.json`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast("Copia descargada.");cerrarModal("mas-overlay");
}

/* ══ TEMA ══ */
function aplicarTema(){
  const dark=document.documentElement.classList.contains("dark");
  $$("[data-tema-ico]").forEach(el=>el.innerHTML=icon(dark?"i-sun":"i-moon"));
  $$("[data-tema-txt]").forEach(el=>el.textContent=dark?"Modo claro":"Modo oscuro");
  const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=dark?"#0E0E10":"#F7F4EF";
}
function alternarTema(){const d=document.documentElement.classList.toggle("dark");try{localStorage.setItem("ensu-dark",d?"1":"0");}catch(_){}aplicarTema();}

/* ══ RETO ANUAL ══ */
const finLectura=e=>e.terminadoEn||e.fecha||"";
const terminadosEn=anio=>visibles().filter(e=>e.tipo==="libro"&&e.estado==="terminado"&&finLectura(e).startsWith(String(anio)));
function retoDe(anio){const v=Store.ajustes()[`reto_${anio}`];return v&&v.objetivo>0?Number(v.objetivo):0;}
function renderReto(){
  const sec=$("sec-reto"),y=new Date().getFullYear(),obj=retoDe(y),admin=Store.isAdmin();
  if(!obj){
    sec.hidden=!admin||!Store.cargado();
    sec.innerHTML=`<button class="reto-vacio" data-act="reto-editar">${icon("i-target")}<span><b>Fija tu reto de lectura de ${y}</b><small>¿Cuántos libros quieres leer este año?</small></span>${icon("i-arrow-r","sm")}</button>`;
    return;
  }
  const hechos=terminadosEn(y).length,pct=Math.min(100,Math.round(hechos/obj*100));
  const ini=new Date(y,0,1),fin=new Date(y+1,0,1),frac=(Date.now()-ini)/(fin-ini);
  const esperado=obj*frac,dif=hechos-esperado;
  const estado=hechos>=obj?"¡Reto cumplido!":dif>=0.5?"Vas por delante del ritmo":dif<=-0.5?`Vas ${Math.max(1,Math.round(-dif))} por detrás del ritmo`:"Vas al día";
  sec.hidden=false;
  sec.innerHTML=`<div class="reto-card">
    <div class="reto-anillo" style="--p:${pct}"><span>${pct}%</span></div>
    <div class="reto-body">
      <p class="eyebrow">Reto de lectura ${y}</p>
      <p class="reto-num"><b>${hechos}</b> de ${obj} libros</p>
      <p class="reto-estado">${estado}${hechos<obj?` · faltan ${obj-hechos}`:""}</p>
    </div>
    <div class="reto-acts">
      <a class="chip-btn" href="#/resumen/${y}">${icon("i-sparkle","sm")} Mi ${y}</a>
      <button class="chip-btn admin-only" data-act="reto-editar">${icon("i-edit","sm")} Editar</button>
    </div>
  </div>`;
}
function abrirReto(){const y=new Date().getFullYear();$("reto-title").textContent=`Reto ${y}`;$("reto-n").value=retoDe(y)||"";abrirModal("reto-overlay");}
async function guardarReto(quitar){
  const y=new Date().getFullYear(),n=parseInt($("reto-n").value,10);
  if(!quitar&&!(n>0)){$("reto-n").classList.add("invalido");return;}
  const btn=$("reto-btn");btn.disabled=true;
  try{await Store.guardarAjuste(`reto_${y}`,{objetivo:quitar?0:n});cerrarModal("reto-overlay");toast(quitar?"Reto eliminado.":"Reto guardado.");renderVista();}
  catch(err){toast(/ajustes|relation|schema/i.test(err&&err.message||"")?"Falta ejecutar supabase/03_mejoras.sql.":errTxt(err),"error");}
  finally{btn.disabled=false;}
}

/* ══ HISTORIAL / RITMO DE LECTURA (solo autor) ══ */
function puntosDe(e){
  return Store.historial().filter(h=>h.id===e.id).map(h=>({t:h.t,p:h.progreso,
    pag:h.pagina!=null?h.pagina:(e.paginasTotal?Math.round(h.progreso/100*e.paginasTotal):null)}));
}
function ritmoHTML(e){
  const pts=puntosDe(e);
  if(pts.length<2)return`<p class="form-hint">Tu ritmo aparecerá aquí cuando actualices el progreso un par de veces.</p>`;
  const t0=pts[0].t,t1=pts[pts.length-1].t,dias=Math.max(1,(t1-t0)/864e5);
  const W=600,H=90,x=t=>((t-t0)/Math.max(1,t1-t0))*W,y=p=>H-6-(p/100)*(H-12);
  const linea=pts.map(q=>`${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join(" ");
  const usaPag=pts[0].pag!=null&&pts[pts.length-1].pag!=null;
  const avance=usaPag?pts[pts.length-1].pag-pts[0].pag:pts[pts.length-1].p-pts[0].p;
  const porDia=avance/dias;
  let prevision="";
  if(e.estado!=="terminado"&&porDia>0){
    const resta=usaPag&&e.paginasTotal?e.paginasTotal-(pts[pts.length-1].pag||0):100-pts[pts.length-1].p;
    const f=new Date(Date.now()+resta/porDia*864e5);
    prevision=`<div class="ritmo-dato"><b>${f.getDate()} ${MESES_C[f.getMonth()]}</b><span>Fecha estimada de fin</span></div>`;
  }
  return`<svg class="ritmo-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${linea}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
    <div class="ritmo-datos">
      <div class="ritmo-dato"><b>${porDia>=10||!usaPag?Math.round(porDia):porDia.toFixed(1)}${usaPag?"":"%"}</b><span>${usaPag?"páginas":"de avance"} al día</span></div>
      <div class="ritmo-dato"><b>${Math.round(dias)}</b><span>${Math.round(dias)===1?"día":"días"} registrados</span></div>
      ${prevision}
    </div>`;
}
/* Páginas leídas por semana (últimas 12), a partir de las diferencias entre registros */
function renderRitmoSemanal(){
  const cont=$("stats-ritmo");if(!cont||!Store.isAdmin())return;
  const porEntrada=new Map();
  visibles().filter(e=>e.tipo==="libro").forEach(e=>porEntrada.set(e.id,e));
  const semanas=[];const hoy=new Date();hoy.setHours(0,0,0,0);
  const lunes=new Date(hoy);lunes.setDate(hoy.getDate()-((hoy.getDay()+6)%7));
  for(let i=11;i>=0;i--){const d=new Date(lunes);d.setDate(lunes.getDate()-i*7);semanas.push({t:d.getTime(),n:0});}
  const ultimo={};
  Store.historial().forEach(h=>{
    const e=porEntrada.get(h.id);if(!e)return;
    const pag=h.pagina!=null?h.pagina:(e.paginasTotal?Math.round(h.progreso/100*e.paginasTotal):null);
    if(pag==null)return;
    const prev=ultimo[h.id];ultimo[h.id]=pag;
    if(prev==null)return;
    const delta=pag-prev;if(delta<=0)return;
    const s=semanas.filter(w=>w.t<=h.t).pop();if(s)s.n+=delta;
  });
  if(!semanas.some(s=>s.n)){cont.innerHTML=`<p class="form-hint">Se irá llenando a medida que actualices las páginas de tus lecturas.</p>`;return;}
  cont.innerHTML=barras(semanas.map(s=>{const d=new Date(s.t);return[`${d.getDate()} ${MESES_C[d.getMonth()]}`,s.n];}));
}

/* ══ CITAS ══ */
function renderCitas(){
  const grid=$("citas-grid");
  if(estadoCarga(grid,4))return;
  const q=norma($("citas-q").value);
  const todas=visibles().filter(e=>e.cita.trim()).sort((a,b)=>fechaNum(b)-fechaNum(a));
  const lista=todas.filter(e=>!q||norma(`${e.cita} ${e.libro} ${e.autor}`).includes(q));
  $("citas-count").textContent=`${todas.length} ${todas.length===1?"cita":"citas"}`;
  grid.innerHTML=lista.length?lista.map(e=>`<figure class="cita-card">
      <span class="cita-mark">“</span>
      <blockquote>${esc(e.cita)}</blockquote>
      <figcaption>
        <button class="cita-fuente" data-act="leer" data-v="${e.id}">${esc(e.libro||e.tituloRef)}${e.autor?`<span> — ${esc(e.autor)}</span>`:""}</button>
        <button class="btn-icon" data-act="cita-img" data-v="${e.id}" title="Compartir como imagen" aria-label="Compartir como imagen">${icon("i-image","sm")}</button>
      </figcaption>
    </figure>`).join(""):`<div class="empty-state">${icon("i-quote")}<p>${q?"No hay citas que coincidan.":"Todavía no hay citas."}</p></div>`;
}

/* Imagen para compartir (1080×1350, formato vertical de Instagram) */
const EstilosImg=[
  {k:"crema",bg:"#F3EEE5",tx:"#1A1714",sub:"#7A7168",ac:"#B08F57"},
  {k:"noche",bg:"#141416",tx:"#EDE8E1",sub:"#8E8882",ac:"#C4A97D"},
  {k:"salvia",bg:"#2F3F35",tx:"#F2EEE6",sub:"#B7C4B9",ac:"#D9C49A"}
];
const ImgCita={id:null,estilo:0,blob:null};
function envolver(ctx,texto,ancho){
  const palabras=texto.split(/\s+/),lineas=[];let l="";
  for(const p of palabras){const prueba=l?l+" "+p:p;if(ctx.measureText(prueba).width>ancho&&l){lineas.push(l);l=p;}else l=prueba;}
  if(l)lineas.push(l);return lineas;
}
async function dibujarCita(e,st){
  const W=1080,H=1350,M=110,c=document.createElement("canvas");c.width=W;c.height=H;
  const ctx=c.getContext("2d");
  try{await Promise.all([document.fonts.load('italic 400 64px "Cormorant Garamond"'),document.fonts.load('600 30px "Inter"'),document.fonts.load('500 64px "Cormorant Garamond"')]);}catch(_){}
  ctx.fillStyle=st.bg;ctx.fillRect(0,0,W,H);
  ctx.fillStyle=st.ac;ctx.font='400 300px "Cormorant Garamond", Georgia, serif';ctx.globalAlpha=.35;ctx.fillText("“",M-20,M+210);ctx.globalAlpha=1;
  // Texto: se reduce hasta que quepa
  let size=76,lineas,alto;
  do{ctx.font=`italic 400 ${size}px "Cormorant Garamond", Georgia, serif`;lineas=envolver(ctx,e.cita.trim(),W-M*2);alto=lineas.length*size*1.28;size-=3;}while(alto>H-M*2-320&&size>34);
  size+=3;const lh=size*1.28;let y=(H-alto)/2+size*.2;
  ctx.fillStyle=st.tx;ctx.textBaseline="top";
  lineas.forEach(l=>{ctx.fillText(l,M,y);y+=lh;});
  // Fuente
  y+=34;ctx.fillStyle=st.ac;ctx.fillRect(M,y,70,3);y+=30;
  ctx.fillStyle=st.sub;ctx.font='600 30px "Inter", system-ui, sans-serif';
  envolver(ctx,[e.libro||e.tituloRef,e.autor].filter(Boolean).join(" — "),W-M*2).slice(0,2).forEach(l=>{ctx.fillText(l,M,y);y+=42;});
  // Marca
  ctx.fillStyle=st.sub;ctx.globalAlpha=.8;ctx.font='500 40px "Cormorant Garamond", Georgia, serif';ctx.textBaseline="alphabetic";
  ctx.fillText("EnSu",M,H-M+10);ctx.font='500 24px "Inter", system-ui, sans-serif';ctx.fillText("Lo que leo me forma",M+100,H-M+6);ctx.globalAlpha=1;
  return new Promise(r=>c.toBlob(r,"image/png"));
}
async function abrirImgCita(id){
  const e=visibles().find(x=>String(x.id)===String(id));if(!e||!e.cita)return;
  ImgCita.id=e.id;
  $("img-estilos").innerHTML=EstilosImg.map((s,i)=>`<button class="img-estilo${i===ImgCita.estilo?" activo":""}" data-act="img-estilo" data-v="${i}" style="background:${s.bg};color:${s.tx}" aria-label="Estilo ${s.k}">“</button>`).join("");
  abrirModal("img-overlay");
  await pintarImgCita();
}
async function pintarImgCita(){
  const e=visibles().find(x=>x.id===ImgCita.id);if(!e)return;
  $$(".img-estilo").forEach((b,i)=>b.classList.toggle("activo",i===ImgCita.estilo));
  ImgCita.blob=await dibujarCita(e,EstilosImg[ImgCita.estilo]);
  const img=$("img-preview");if(img.dataset.url)URL.revokeObjectURL(img.dataset.url);
  img.dataset.url=URL.createObjectURL(ImgCita.blob);img.src=img.dataset.url;
}
function nombreImg(){const e=visibles().find(x=>x.id===ImgCita.id);return`cita-${norma(e?e.libro||"ensu":"ensu").replace(/[^a-z0-9]+/g,"-").slice(0,40)}.png`;}
function descargarImg(){if(!ImgCita.blob)return;const a=document.createElement("a");a.href=URL.createObjectURL(ImgCita.blob);a.download=nombreImg();document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
async function compartirImg(){
  if(!ImgCita.blob)return;
  const file=new File([ImgCita.blob],nombreImg(),{type:"image/png"});
  try{
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file]});return;}
    descargarImg();toast("Tu navegador no permite compartir imágenes: se ha descargado.");
  }catch(err){if(err&&err.name!=="AbortError")toast("No se pudo compartir.","error");}
}

/* ══ RESUMEN DEL AÑO ══ */
function aniosConDatos(){const s=new Set();visibles().forEach(e=>{const f=finLectura(e)||e.fecha;if(f)s.add(f.slice(0,4));});return[...s].sort().reverse();}
function renderResumen(){
  const cont=$("resumen-body");
  if(!Store.cargado()){cont.innerHTML=`<div class="skel" style="height:320px;margin:40px 0"></div>`;return;}
  const anios=aniosConDatos(),actual=String(new Date().getFullYear());
  const y=/^\d{4}$/.test(App.param)?App.param:(anios.includes(actual)?actual:anios[0]||actual);
  document.title=`Mi ${y} en libros · EnSu`;
  const libros=terminadosEn(y).sort((a,b)=>finLectura(a).localeCompare(finLectura(b)));
  const escritos=visibles().filter(e=>e.tipo!=="libro"&&(e.fecha||"").startsWith(y));
  const delAnio=[...libros,...escritos];
  const paginas=libros.reduce((s,e)=>s+(e.paginasTotal||0),0);
  const cuenta=f=>{const c={};delAnio.forEach(e=>[].concat(f(e)).filter(Boolean).forEach(v=>c[v]=(c[v]||0)+1));return Object.entries(c).sort((a,b)=>b[1]-a[1]);};
  const cats=cuenta(e=>e.categoria),auts=cuenta(e=>e.tipo==="libro"?e.autor:null),tags=cuenta(e=>e.tags);
  const fav=libros.filter(e=>e.puntuacion).sort((a,b)=>b.puntuacion-a.puntuacion)[0];
  const citas=delAnio.filter(e=>e.cita.trim());
  const cita=citas.length?citas[hash(y)%citas.length]:null;
  const obj=retoDe(y);
  const selector=anios.length>1?`<div class="pills res-anios">${anios.map(a=>`<a class="pill${a===y?" activo":""}" href="#/resumen/${a}">${a}</a>`).join("")}</div>`:"";
  if(!delAnio.length){cont.innerHTML=`<header class="page-head"><p class="eyebrow">Resumen del año</p><h1 class="page-title">Mi ${y} en libros</h1></header>${selector}<div class="empty-state">${icon("i-book")}<p>Todavía no hay lecturas terminadas en ${y}.</p></div>`;return;}
  const num=(n,l)=>`<div class="res-num"><b>${n}</b><span>${l}</span></div>`;
  cont.innerHTML=`
    <header class="res-hero">
      <p class="eyebrow">Resumen del año</p>
      <h1 class="res-title">Mi <em>${y}</em> en libros</h1>
      <div class="res-nums">
        ${num(libros.length,libros.length===1?"libro leído":"libros leídos")}
        ${paginas?num(paginas.toLocaleString("es"),"páginas"):""}
        ${num(escritos.length,escritos.length===1?"reflexión o artículo":"reflexiones y artículos")}
        ${num(new Set(libros.map(e=>e.autor).filter(Boolean)).size,"autores")}
      </div>
      ${obj?`<p class="res-reto">${libros.length>=obj?"✓ Reto cumplido":"Reto"}: ${libros.length} de ${obj} libros</p>`:""}
      <div class="res-share"><button class="chip-btn" data-act="compartir-resumen" data-v="${y}">${icon("i-share","sm")} Compartir</button></div>
    </header>
    ${selector}
    ${libros.length?`<section class="sec"><div class="sec-head"><h2 class="sec-title">Mi estantería de ${y}</h2></div>
      <div class="res-muro">${libros.map(e=>{Portadas.pedir(e);return`<div class="res-libro" data-act="leer" data-v="${e.id}" tabindex="0" title="${esc(e.libro)}">${Portadas.html(e)}</div>`;}).join("")}</div></section>`:""}
    <div class="res-grid">
      ${fav?`<div class="res-card res-fav" data-act="leer" data-v="${fav.id}" tabindex="0"><p class="eyebrow">Mi favorito</p><div class="res-fav-in">${Portadas.html(fav)}<div><h3>${esc(fav.libro)}</h3><p>${esc(fav.autor)}</p><div class="rdots">${Array.from({length:10},(_,i)=>`<i class="${i<fav.puntuacion?"on":""}"></i>`).join("")}</div></div></div></div>`:""}
      ${cats.length?`<div class="res-card"><p class="eyebrow">Temas</p>${barras(cats.slice(0,5))}</div>`:""}
      ${auts.filter(a=>a[1]>1).length?`<div class="res-card"><p class="eyebrow">Autores que repetí</p>${barras(auts.filter(a=>a[1]>1).slice(0,5))}</div>`:""}
      ${tags.length?`<div class="res-card"><p class="eyebrow">Ideas que más se repitieron</p><div class="tag-cloud">${tags.slice(0,10).map(([t,n])=>`<span class="tag" data-act="tag" data-v="${esc(t)}">${esc(t)}<span>${n}</span></span>`).join("")}</div></div>`:""}
    </div>
    ${cita?`<figure class="leer-cita res-cita"><span class="leer-cita-mark">“</span><blockquote class="leer-cita-txt">${esc(cita.cita)}</blockquote><figcaption>${esc(cita.libro||cita.tituloRef)}${cita.autor?` — ${esc(cita.autor)}`:""}</figcaption></figure>`:""}
    <div style="height:56px"></div>`;
}

/* ══ PORTADAS EN EL FORMULARIO: elegir entre ediciones o subir foto ══ */
async function elegirPortada(){
  const libro=fEl("libro").value.trim();
  if(!libro){toast("Escribe primero el título del libro.","error");return;}
  const box=$("cover-opciones");box.hidden=false;
  box.innerHTML=`<p class="form-hint">Buscando portadas…</p>`;
  try{
    const ops=await Portadas.opciones({libro,autor:fEl("autor").value.trim()});
    const sel=Number(fEl("portadaId").value)||0;
    box.innerHTML=ops.length?`<p class="form-hint">Elige una portada:</p><div class="cover-grid">${ops.map(o=>`<button type="button" class="cover-op${o.id===sel?" activo":""}" data-act="portada-sel" data-v="${o.id}" title="${esc(o.titulo)}"><img src="https://covers.openlibrary.org/b/id/${o.id}-M.jpg" alt="${esc(o.titulo)}" loading="lazy"></button>`).join("")}</div>`
      :`<p class="form-hint">No he encontrado portadas. Puedes subir una foto.</p>`;
  }catch(_){box.innerHTML=`<p class="form-hint">No se pudo buscar ahora. Inténtalo de nuevo o sube una foto.</p>`;}
}
function seleccionarPortada(id){
  fEl("portadaId").value=id;fEl("portada").value="";
  $$(".cover-op").forEach(b=>b.classList.toggle("activo",b.dataset.v===String(id)));
  actualizarPreviewPortada();
}
function comprimirImagen(file,max=900){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      const k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");
      c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
      c.toBlob(b=>b?res(b):rej(new Error("imagen")),"image/jpeg",.86);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("imagen"));};
    img.src=url;
  });
}
async function subirPortada(file){
  if(!file)return;
  if(!/^image\//.test(file.type)){toast("Elige una imagen.","error");return;}
  const prev=$("cover-prev");prev.style.opacity=".5";
  try{
    const blob=await comprimirImagen(file);
    const url=await Store.subirPortada(blob,Form.id);
    fEl("portada").value=url;fEl("portadaId").value="";
    actualizarPreviewPortada();toast("Portada subida. Guarda la entrada para aplicarla.");
  }catch(err){toast(/bucket|not found|policy|403|42501/i.test(`${err&&err.message} ${err&&err.statusCode}`)?"Falta ejecutar supabase/03_mejoras.sql para poder subir portadas.":"No se pudo subir la imagen.","error");}
  finally{prev.style.opacity="";fEl("portada-file").value="";}
}

/* ══ ENLACES PARA COMPARTIR (con vista previa en WhatsApp/redes vía Vercel) ══ */
const esLocal=()=>/^(localhost|127\.0\.0\.1)$/.test(location.hostname)||location.protocol==="file:";
const enlaceEntrada=id=>esLocal()?`${location.origin}${location.pathname}#/leer/${id}`:`${location.origin}/e/${id}`;
const enlaceResumen=y=>esLocal()?`${location.origin}${location.pathname}#/resumen/${y}`:`${location.origin}/r/${y}`;
async function compartirEnlace(url,title){
  try{
    if(navigator.share){await navigator.share({title,url});return;}
    await navigator.clipboard.writeText(url);toast("Enlace copiado.");
  }catch(err){if(err&&err.name!=="AbortError")toast("No se pudo copiar el enlace.","error");}
}

/* ══ APP INSTALABLE (service worker) ══ */
function registrarSW(){
  if(!("serviceWorker" in navigator)||location.protocol==="file:")return;
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(err=>console.warn("EnSu SW:",err&&err.message)));
  window.addEventListener("offline",()=>toast("Sin conexión: verás la última versión guardada."));
  window.addEventListener("online",()=>toast("Conexión recuperada."));
}

/* ══ ACCIONES (delegación de eventos: sin onclick en el HTML generado) ══ */
const ACCIONES={
  leer:(v,el,ev)=>{App.leerDesdeApp=true;ir("#/leer/"+v);},
  "leer-progreso":v=>{App.leerDesdeApp=true;ir("#/leer/"+v);setTimeout(()=>{const q=$("q-val");if(q){q.scrollIntoView({block:"center"});q.focus();}},320);},
  tag:v=>{if(App.leerId!=null){App.leerDesdeApp=false;history.replaceState(null,"","#/etiqueta/"+encodeURIComponent(v));onRoute();}else ir("#/etiqueta/"+encodeURIComponent(v));},
  nav:v=>ir(v==="home"?"#/":"#/"+v),
  nuevo:()=>abrirForm(null),
  editar:v=>abrirForm(v),
  eliminar:v=>eliminarEntrada(v),
  "leer-editar":()=>abrirForm(App.leerId),
  "leer-eliminar":()=>eliminarEntrada(App.leerId),
  "cerrar-leer":()=>cerrarLeer(),
  compartir:()=>compartir(),
  "q-guardar":v=>guardarProgresoRapido(v,false),
  "q-terminado":v=>guardarProgresoRapido(v,true),
  "home-tipo":v=>{App.home.tipo=v;renderHomeGrid();},
  "home-sort":()=>{App.home.desc=!App.home.desc;renderHomeGrid();},
  "home-filtros":()=>{$("filtros-panel").classList.toggle("open");renderFiltrosHome();},
  "home-limpiar":()=>{Object.assign(App.home,{finalidad:"",categoria:"",estado:"",dificultad:""});renderFiltrosHome();renderHomeGrid();},
  "home-reset":()=>{Object.assign(App.home,{tipo:"Todos",q:"",finalidad:"",categoria:"",estado:"",dificultad:""});$("home-q").value="";$("home-q-clear").hidden=true;renderFiltrosHome();renderHomeGrid();},
  "home-q-clear":()=>{App.home.q="";$("home-q").value="";$("home-q-clear").hidden=true;renderHomeGrid();},
  "lib-q-clear":()=>{App.lib.q="";$("lib-q").value="";$("lib-q-clear").hidden=true;renderBiblioteca();},
  cita:()=>renderCita(true),
  "cita-fuente":(v,el)=>{if(el.dataset.v)ACCIONES.leer(el.dataset.v);},
  "lib-tab":v=>{App.lib.tab=v;renderBiblioteca();},
  "ver-porleer":()=>{App.lib.tab="porleer";ir("#/biblioteca");},
  "lib-sort":v=>{const L=App.lib;if(L.sort===v)L.dir*=-1;else{L.sort=v;L.dir=v==="fecha"||v==="puntuacion"?-1:1;}renderBiblioteca();},
  login:()=>{cerrarModal("mas-overlay");abrirLogin();},
  logout:()=>hacerLogout(),
  tema:()=>alternarTema(),
  mas:()=>abrirModal("mas-overlay"),
  "mas-ir":v=>{cerrarModal("mas-overlay");ir(v==="home"?"#/":"#/"+v);},
  copia:()=>descargarCopia(),
  cerrar:(v)=>cerrarModal(v),
  "form-prev":()=>irPaso(Math.max(0,Form.paso-1)),
  "form-next":()=>siguiente(),
  "form-paso":v=>irPaso(Number(v)),
  "form-del":()=>eliminarEntrada(Form.id),
  "borrador-si":()=>restaurarBorrador(),
  "borrador-no":()=>borrarBorrador(),
  "portada-buscar":()=>{fEl("portada").value="";fEl("portadaId").value="";$("cover-opciones").hidden=true;const prev=Form.id!=null?visibles().find(x=>x.id===Form.id):null;if(prev)Portadas.reintentar(prev);actualizarPreviewPortada();toast("Al guardar se buscará la portada automáticamente.");},
  "reto-editar":()=>abrirReto(),
  "reto-guardar":()=>guardarReto(false),
  "reto-quitar":()=>guardarReto(true),
  "cita-img":v=>abrirImgCita(v),
  "img-estilo":v=>{ImgCita.estilo=Number(v);pintarImgCita();},
  "img-descargar":()=>descargarImg(),
  "img-compartir":()=>compartirImg(),
  "portada-elegir":()=>elegirPortada(),
  "portada-sel":v=>seleccionarPortada(Number(v)),
  "portada-subir":()=>fEl("portada-file").click(),
  "compartir-resumen":v=>compartirEnlace(enlaceResumen(v),`Mi ${v} en libros · EnSu`),
  "t-nueva":()=>abrirTarea(null),
  "t-editar":v=>abrirTarea(v),
  "t-eliminar":async v=>{if(!confirm("¿Eliminar esta tarea?"))return;try{await Store.eliminarTarea(Number(v));toast("Tarea eliminada.");}catch(err){toast(errTxt(err),"error");}},
  "t-mover":(v,el)=>Store.actualizarTarea(Number(v),{estado:el.dataset.e}).catch(err=>toast(errTxt(err),"error")),
  "t-filtro":v=>{App.tareas.filtro=v;renderTareas();},
  "t-guardar":()=>guardarTarea(),
  "login-go":()=>hacerLogin(),
  "login-reset":()=>recuperarPwd(),
  "pwd-guardar":()=>guardarNuevaPwd(),
  recargar:()=>location.reload()
};
document.addEventListener("click",ev=>{
  const el=ev.target.closest("[data-act]");
  if(!el)return;
  const f=ACCIONES[el.dataset.act];
  if(!f)return;
  ev.preventDefault();
  f(el.dataset.v,el,ev);
});
document.addEventListener("keydown",ev=>{
  if(ev.key==="Escape"){
    const m=modalAbierto();
    if(m){cerrarModal(m.id);return;}
    if(App.leerId!=null)cerrarLeer();
    return;
  }
  if((ev.key==="Enter"||ev.key===" ")&&ev.target.matches("[data-act][tabindex]")){ev.preventDefault();ev.target.click();}
});
/* Cerrar modal al pulsar fuera */
document.addEventListener("mousedown",ev=>{if(ev.target.classList&&ev.target.classList.contains("modal-overlay"))cerrarModal(ev.target.id);});

/* ══ 7. INIT ══ */
function initEventos(){
  let tq;
  $("home-q").addEventListener("input",e=>{clearTimeout(tq);$("home-q-clear").hidden=!e.target.value;tq=setTimeout(()=>{App.home.q=e.target.value.trim();renderHomeGrid();},140);});
  $("lib-q").addEventListener("input",e=>{clearTimeout(tq);$("lib-q-clear").hidden=!e.target.value;tq=setTimeout(()=>{App.lib.q=e.target.value.trim();renderBiblioteca();},140);});
  [["f-home-finalidad","finalidad"],["f-home-categoria","categoria"],["f-home-estado","estado"],["f-home-dificultad","dificultad"]].forEach(([id,k])=>$(id).addEventListener("change",e=>{App.home[k]=e.target.value;e.target.classList.toggle("activo",!!e.target.value);renderHomeGrid();}));
  $("f-lib-tipo").addEventListener("change",e=>{App.lib.tipo=e.target.value;renderBiblioteca();});
  $("f-lib-categoria").addEventListener("change",e=>{App.lib.categoria=e.target.value;renderBiblioteca();});
  $("citas-q").addEventListener("input",()=>{clearTimeout(tq);tq=setTimeout(renderCitas,140);});
  fEl("portada-file").addEventListener("change",e=>subirPortada(e.target.files[0]));
  $("reto-n").addEventListener("keydown",e=>{if(e.key==="Enter")guardarReto(false);});
  $("reto-n").addEventListener("input",e=>e.target.classList.remove("invalido"));
  $("t-sort").addEventListener("change",e=>{App.tareas.sort=e.target.value;renderTareas();});
  const form=$("libro-form");
  form.addEventListener("submit",guardarForm);
  form.addEventListener("input",e=>{
    const k=(e.target.id||"").replace(/^f-/,"");
    if(["paginasTotal","paginaActual","estado"].includes(k))syncProgreso();
    if(k==="progreso")$("progreso-val").textContent=e.target.value+"%";
    if(k==="tipo")syncTipo();
    if(["portada","libro","autor"].includes(k))actualizarPreviewPortada();
    if(e.target.classList.contains("invalido")){e.target.classList.remove("invalido");const m=$("err-"+k);if(m)m.classList.remove("visible");}
    guardarBorrador();
  });
  form.addEventListener("change",e=>{if(e.target.id==="f-estado"||e.target.id==="f-tipo"){syncProgreso();syncTipo();}});
  // Evita que Enter en un input envíe el formulario antes del último paso
  form.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.tagName==="INPUT"){e.preventDefault();if(Form.paso<2)siguiente();}});
  $("login-pwd").addEventListener("keydown",e=>{if(e.key==="Enter")hacerLogin();});
  $("login-email").addEventListener("keydown",e=>{if(e.key==="Enter")$("login-pwd").focus();});
  $("t-titulo").addEventListener("keydown",e=>{if(e.key==="Enter")guardarTarea();});
  $("leer-panel").addEventListener("scroll",e=>{const p=e.target;const max=p.scrollHeight-p.clientHeight;$("leer-line").style.width=(max>0?p.scrollTop/max*100:0)+"%";},{passive:true});
  window.addEventListener("scroll",()=>$("main-nav").classList.toggle("scrolled",window.scrollY>12),{passive:true});
  window.addEventListener("hashchange",onRoute);
  $("footer-year").textContent=new Date().getFullYear();
}

function init(){
  // Enlaces antiguos: ?leer=ID y lista.html
  const qs=new URLSearchParams(location.search);
  if(qs.get("leer"))history.replaceState(null,"",location.pathname+"#/leer/"+encodeURIComponent(qs.get("leer")));
  aplicarTema();
  initEventos();
  registrarSW();
  Store.onAuth(admin=>{
    document.body.classList.toggle("admin",admin);
    $$("[data-lock-ico]").forEach(el=>el.innerHTML=icon(admin?"i-unlock":"i-lock"));
    $$("[data-lock-txt]").forEach(el=>el.textContent=admin?"Cerrar sesión":"Acceso autor");
    if(App.vista==="tareas"||parseHash().v==="tareas")onRoute();
  });
  Store.onChange(()=>{
    renderVista();
    if(App.leerId!=null)renderLeer(false);
  });
  try{Store.init();}catch(err){console.error(err);}
  onRoute();
}
document.addEventListener("DOMContentLoaded",init);
