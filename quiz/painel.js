/* ==========================================================================
   Quiz ao vivo · painel do professor (é também o que vai para o telão)

   Ordem de uma pergunta: abrir -> fechar -> revelar. Cada clique reescreve o
   estado inteiro, então voltar atrás é só clicar de novo.

   ?p=<id>      já abre o painel com essa pergunta selecionada (os slides usam)
   ?telao=1     esconde a barra de controle de saída
   ========================================================================== */

import { acompanhar, gravar, LETRAS, resumir, esc, carregarPerguntas } from "./rtdb.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const ENDERECO = new URL("./", location.href).href.replace(/^https?:\/\//, "").replace(/\/$/, "");
const st = { perguntas: [], pub: null, respostas: {}, parar: null, vendo: null };

function chave() { return $("#chave").value.trim(); }
function recado(t, ruim) {
  const n = $("#estado");
  n.textContent = t;
  n.style.color = ruim ? "var(--marca)" : "var(--fraco)";
}

async function comandar(aberto, revelado) {
  const id = $("#pergunta").value;
  if (!chave()) return recado("falta a chave do professor", true);
  try {
    await gravar("estado", {
      chave: chave(),
      pub: { pergunta: id, aberto, revelado, versao: { ".sv": "timestamp" } },
    });
    try { sessionStorage.setItem("mkt2026-chave", chave()); } catch { /* sem armazenamento */ }
    recado(aberto ? "aberta" : revelado ? "revelada" : "fechada");
  } catch (e) {
    recado(String(e.message || e), true);
  }
}

async function limpar() {
  const id = $("#pergunta").value;
  if (!chave()) return recado("falta a chave do professor", true);
  try {
    await gravar("limpeza", { chave: chave(), pergunta: id, quando: { ".sv": "timestamp" } });
    await gravar(`respostas/${id}`, null);
    recado("respostas apagadas");
  } catch (e) {
    recado(String(e.message || e), true);
  }
}

function ver(id) {
  if (st.vendo === id) return;
  st.vendo = id;
  st.parar && st.parar();
  st.respostas = {};
  st.parar = acompanhar(`respostas/${id}`, (r) => { st.respostas = r || {}; desenhar(); });
  desenhar();
}

function qr(texto) {
  // QR gerado por um serviço público só para o telão; o endereço também fica escrito embaixo.
  return `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=0&data=${encodeURIComponent(texto)}`;
}

function desenhar() {
  const p = st.perguntas.find((x) => x.id === st.vendo);
  const t = $("#telao");
  if (!p) { t.innerHTML = "<p>Escolha uma pergunta.</p>"; return; }
  const ativa = st.pub?.pergunta === p.id;
  const aberto = ativa && st.pub.aberto, revelado = ativa && st.pub.revelado;
  const res = resumir(p, st.respostas);
  const situacao = !ativa ? "não publicada" : aberto ? "respondendo agora" : revelado ? "resultado" : "encerrada";

  let corpo = "";
  if (p.tipo === "multipla") {
    corpo = `<div class="resultado">${p.opcoes.map((o, i) => {
      const frac = res.total ? Math.round((100 * res.contagem[i]) / res.total) : 0;
      const certa = revelado && p.certa === i ? " certa" : "";
      return `<div class="linha${certa}"><span class="letra">${LETRAS[i]}</span>
        <div class="trilho"><i style="width:${revelado ? frac : 0}%"></i><span>${esc(o)}</span></div>
        <span class="pct">${revelado ? frac + "%" : ""}</span></div>`;
    }).join("")}</div>`;
  } else if (p.tipo === "numero") {
    const [a, b] = p.escala || [Math.min(0, ...res.nums), Math.max(1, ...res.nums)];
    const pos = (x) => 100 * (Math.min(b, Math.max(a, x)) - a) / (b - a || 1);
    const pilhas = {};
    const pts = res.nums.map((x) => {
      const k = Math.round(pos(x) / 2.5);
      pilhas[k] = (pilhas[k] || 0) + 1;
      return `<i class="p" style="left:${pos(x)}%;bottom:${(pilhas[k] - 1) * 21}px"></i>`;
    }).join("");
    const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => a + f * (b - a))
      .map((v) => `<span class="eixo" style="left:${pos(v)}%">${(+v.toFixed(2)).toLocaleString("pt-BR")}</span>`).join("");
    const media = res.media != null && revelado
      ? `<div class="media" style="left:${pos(res.media)}%"><span>média ${(+res.media.toFixed(2)).toLocaleString("pt-BR")}</span></div>` : "";
    const real = p.valor != null && revelado
      ? `<div class="media real" style="left:${pos(p.valor)}%"><span>valor real ${(+p.valor).toLocaleString("pt-BR")}</span></div>` : "";
    corpo = `<div class="pontos">${revelado || p.mostrarAoVivo ? pts : ""}${media}${real}${marcas}</div>`;
  } else {
    const mostrar = revelado || p.mostrarAoVivo;
    corpo = `<div class="mural">${mostrar ? res.textos.map((x) => p.tipo === "link"
      ? `<div class="cartao"><a href="${esc(x)}" target="_blank" rel="noopener">${esc(x.replace(/^https?:\/\//, ""))}</a></div>`
      : `<div class="cartao">${esc(x)}</div>`).join("") : ""}</div>`;
  }

  const enderecoAluno = `${ENDERECO}/`;
  t.innerHTML = `
    <div class="qr"><img src="${location.hostname.endsWith("github.io") ? "qr.svg" : qr("https://" + enderecoAluno)}" alt="QR do quiz"><div class="endereco">${esc(enderecoAluno)}</div></div>
    <div>
      ${p.contexto ? `<div class="contexto">${esc(p.contexto)}</div>` : ""}
      <h1>${esc(p.enunciado)}</h1>
      <div class="contagem">${res.total} ${res.total === 1 ? "resposta" : "respostas"} · ${situacao}</div>
      ${corpo}
      ${revelado && p.porque ? `<div class="porque">${esc(p.porque)}</div>` : ""}
    </div>`;
}

async function iniciar() {
  st.perguntas = await carregarPerguntas();
  const sel = $("#pergunta");
  let grupo = null, og = null;
  for (const p of st.perguntas) {
    if (p.aula !== grupo) { grupo = p.aula; og = document.createElement("optgroup"); og.label = grupo; sel.append(og); }
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.id} · ${p.enunciado.slice(0, 60)}`;
    og.append(o);
  }
  try { $("#chave").value = sessionStorage.getItem("mkt2026-chave") || ""; } catch { /* nada */ }
  if (params.get("p")) sel.value = params.get("p");
  if (params.get("telao") === "1") $("#controle").classList.add("escondido");

  sel.addEventListener("change", () => ver(sel.value));
  $("#abrir").onclick = () => comandar(true, false);
  $("#fechar").onclick = () => comandar(false, false);
  $("#revelar").onclick = () => comandar(false, true);
  $("#limpar").onclick = limpar;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#controle").classList.toggle("escondido");
  });

  acompanhar("estado/pub", (pub) => {
    st.pub = pub;
    if (pub?.pergunta && !params.get("p") && sel.value !== pub.pergunta && st.vendo === null) sel.value = pub.pergunta;
    desenhar();
  });
  ver(sel.value);
}

iniciar();
