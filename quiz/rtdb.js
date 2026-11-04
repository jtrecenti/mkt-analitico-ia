/* ==========================================================================
   Conversa com o Firebase Realtime Database, pela API REST.

   Sem SDK: o banco aceita GET/PUT/PATCH em `<caminho>.json` e transmite
   mudanças ao vivo por Server-Sent Events (EventSource). Isso basta para um
   quiz de sala e mantém o site 100% estático (GitHub Pages).

   O que as regras do banco garantem (ver firebase/database.rules.json):
     - qualquer um lê o estado público do quiz e as respostas (anônimas);
     - o aluno só grava a própria resposta, e só na pergunta que está aberta;
     - só quem conhece a chave do professor muda o estado do quiz. A chave não
       está neste repositório: ela mora num nó do banco que ninguém lê.
   ========================================================================== */

const PADRAO = {
  banco: "https://jtrecenti-default-rtdb.firebaseio.com",
  raiz: "mkt2026",
};

const params = new URLSearchParams(location.search);
export const CONFIG = {
  banco: params.get("banco") || PADRAO.banco,
  raiz: params.get("raiz") || PADRAO.raiz,
  // ?banco=http://127.0.0.1:9000&ns=demo-mkt-default-rtdb usa o emulador local do Firebase
  ns: params.get("ns"),
};

const url = (caminho) => `${CONFIG.banco}/${CONFIG.raiz}/${caminho}.json${CONFIG.ns ? `?ns=${CONFIG.ns}` : ""}`;

export async function ler(caminho) {
  const r = await fetch(url(caminho));
  if (!r.ok) throw new Error(`leitura negada (${r.status})`);
  return r.json();
}

export async function gravar(caminho, valor, metodo = "PUT") {
  const r = await fetch(url(caminho), {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(valor),
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new Error(r.status === 401 || r.status === 403 ? "o banco recusou a gravação" : `erro ${r.status} ${corpo.slice(0, 80)}`);
  }
  return r.json().catch(() => null);
}

/**
 * Acompanha um caminho ao vivo. `aoMudar(valorCompleto)` é chamado a cada
 * mudança. Se o streaming cair (rede de sala cheia), cai para leitura
 * periódica sem avisar ninguém. Devolve uma função que para de acompanhar.
 */
export function acompanhar(caminho, aoMudar, { intervalo = 3000 } = {}) {
  let valor = null;
  let parado = false;
  let fonte = null;
  let relogio = null;

  function aplicar(path, dados, patch) {
    if (path === "/") {
      valor = patch && valor && typeof valor === "object" ? { ...valor, ...dados } : dados;
    } else {
      const partes = path.split("/").filter(Boolean);
      valor = valor && typeof valor === "object" ? structuredClone(valor) : {};
      let no = valor;
      for (let i = 0; i < partes.length - 1; i++) {
        if (!no[partes[i]] || typeof no[partes[i]] !== "object") no[partes[i]] = {};
        no = no[partes[i]];
      }
      const ultima = partes[partes.length - 1];
      if (patch && dados && typeof dados === "object") no[ultima] = { ...(no[ultima] || {}), ...dados };
      else if (dados === null) delete no[ultima];
      else no[ultima] = dados;
    }
    aoMudar(valor);
  }

  function sondar() {
    clearInterval(relogio);
    const vez = async () => {
      if (parado) return;
      try { valor = await ler(caminho); aoMudar(valor); } catch { /* tenta de novo */ }
    };
    vez();
    relogio = setInterval(vez, intervalo);
  }

  try {
    fonte = new EventSource(url(caminho));
    const tratar = (patch) => (ev) => {
      try {
        const { path, data } = JSON.parse(ev.data);
        aplicar(path, data, patch);
      } catch { /* evento malformado: ignora */ }
    };
    fonte.addEventListener("put", tratar(false));
    fonte.addEventListener("patch", tratar(true));
    fonte.addEventListener("cancel", () => { fonte.close(); sondar(); });
    fonte.onerror = () => {
      if (fonte.readyState === EventSource.CLOSED && !parado) sondar();
    };
  } catch {
    sondar();
  }

  return () => { parado = true; fonte && fonte.close(); clearInterval(relogio); };
}

/* Identificador do aparelho: não é login, só faz o segundo toque substituir o
   primeiro em vez de virar dois votos. */
export function aparelho() {
  const CHAVE = "mkt2026-aparelho";
  try {
    let v = localStorage.getItem(CHAVE);
    if (!v) { v = crypto.randomUUID().replace(/-/g, "").slice(0, 14); localStorage.setItem(CHAVE, v); }
    return v;
  } catch {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  }
}

export const LETRAS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Resumo das respostas de uma pergunta, no formato que aluno e painel usam. */
export function resumir(p, respostas) {
  const lista = Object.values(respostas || {}).map((r) => r && r.v).filter((v) => v !== undefined && v !== null && v !== "");
  if (p.tipo === "multipla") {
    const contagem = p.opcoes.map(() => 0);
    // com "outro": true, quem escolhe Outro grava um texto no lugar do número
    const outros = [];
    for (const v of lista) {
      if (Number.isInteger(v) && v >= 0 && v < contagem.length) contagem[v]++;
      else if (p.outro && typeof v === "string") outros.push(v);
    }
    return { total: lista.length, contagem, outros };
  }
  if (p.tipo === "numero") {
    const nums = lista.map(Number).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const media = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
    const mediana = nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null;
    return { total: nums.length, nums, media, mediana };
  }
  return { total: lista.length, textos: lista.map(String) };
}

/* Perguntas: perguntas.json (público) e perguntas-extra.json, que só existe no
   site depois que a aula correspondente acontece (spoilers do estúdio 3). */
export async function carregarPerguntas() {
  const base = (await (await fetch("perguntas.json", { cache: "no-store" })).json()).perguntas;
  try {
    const r = await fetch("perguntas-extra.json", { cache: "no-store" });
    if (r.ok) {
      const extra = (await r.json()).perguntas;
      const pos = base.findIndex((p) => p.id === "e3-fator");
      base.splice(pos < 0 ? base.length : pos + 1, 0, ...extra);
    }
  } catch { /* sem extras: segue só com as públicas */ }
  return base;
}
