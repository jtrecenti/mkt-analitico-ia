/* ==========================================================================
   Quiz ao vivo · celular do aluno

   O celular não decide nada: acompanha o estado público que o painel do
   professor publica (qual pergunta, aberta ou não, revelada ou não) e desenha.
   Quatro tipos de pergunta:
     multipla  toque numa alternativa (dá para trocar enquanto estiver aberta)
     numero    um número (ex.: o R² que o seu ChatGPT encontrou)
     texto     uma frase curta (ex.: a recomendação que a IA deu)
     link      um endereço (ex.: o dashboard publicado), vai para o mural
   ========================================================================== */

import { acompanhar, gravar, aparelho, LETRAS, resumir, carregarPerguntas } from "./rtdb.js";

const eu = aparelho();
const estado = { perguntas: [], pub: null, respostas: {}, pararRespostas: null };
const $ = (s) => document.querySelector(s);

function el(tag, attrs = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "texto") n.textContent = v;
    else if (k === "classe") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const f of [].concat(filhos)) if (f) n.append(f);
  return n;
}

const pergunta = () => estado.perguntas.find((p) => p.id === estado.pub?.pergunta) || null;
const minha = () => estado.respostas?.[eu]?.v;

function conexao(t, ruim) {
  const n = $("#conexao");
  n.textContent = t;
  n.style.color = ruim ? "var(--marca)" : "var(--fraco)";
}

async function responder(valor) {
  const p = pergunta();
  if (!p || !estado.pub?.aberto) return;
  const antes = estado.respostas[eu];
  estado.respostas = { ...estado.respostas, [eu]: { v: valor } };
  desenhar();
  try {
    await gravar(`respostas/${p.id}/${eu}`, { v: valor, t: { ".sv": "timestamp" } });
  } catch (e) {
    estado.respostas = { ...estado.respostas, [eu]: antes };
    desenhar();
    aviso("A resposta não foi registrada", String(e.message || e));
  }
}

function aviso(titulo, texto) {
  const p = el("div", { classe: "painel aviso" }, [el("b", { texto: titulo }), el("span", { texto })]);
  $("#tela").prepend(p);
  setTimeout(() => p.remove(), 4500);
}

function desenhar() {
  const tela = $("#tela");
  tela.replaceChildren();
  const pub = estado.pub;
  if (!pub || !pub.pergunta) {
    tela.append(el("div", { classe: "espera" }, [el("div", { classe: "ponto" }), el("div", { texto: "Esperando o professor abrir uma pergunta." })]));
    return;
  }
  const p = pergunta();
  if (!p) {
    tela.append(el("div", { classe: "espera" }, [el("div", { texto: "Há uma pergunta nova. Recarregue a página." })]));
    return;
  }
  if (p.contexto) tela.append(el("div", { classe: "contexto", texto: p.contexto }));
  tela.append(el("h1", { texto: p.enunciado }));

  const aberto = Boolean(pub.aberto), revelado = Boolean(pub.revelado);
  const v = minha();

  if (p.tipo === "multipla") {
    const res = revelado ? resumir(p, estado.respostas) : null;
    const box = el("div", { classe: "opcoes" });
    p.opcoes.forEach((texto, i) => {
      const cls = ["opcao"];
      if (v === i) cls.push("escolhida");
      if (revelado && p.certa === i) cls.push("certa");
      if (revelado && v === i && p.certa != null && p.certa !== i) cls.push("errada");
      const corpo = el("span", {}, [el("span", { texto })]);
      if (res && res.total) {
        const frac = Math.round((100 * res.contagem[i]) / res.total);
        corpo.append(el("div", { classe: "barra" }, [el("i", { style: `width:${frac}%` })]), el("div", { classe: "votos", texto: `${res.contagem[i]} de ${res.total} (${frac}%)` }));
      }
      box.append(el("button", { classe: cls.join(" "), type: "button", disabled: !aberto, onclick: () => responder(i) }, [el("span", { classe: "letra", texto: LETRAS[i] }), corpo]));
    });
    tela.append(box);
  } else {
    const multi = p.tipo === "texto" && (p.linhas || 1) > 1;
    const campo = multi
      ? el("textarea", { classe: "campo", maxlength: p.max || 400, placeholder: p.dica || "" })
      : el("input", {
          classe: "campo",
          type: p.tipo === "numero" ? "number" : p.tipo === "link" ? "url" : "text",
          inputmode: p.tipo === "numero" ? "decimal" : null,
          step: p.tipo === "numero" ? "any" : null,
          maxlength: p.max || 200,
          placeholder: p.dica || "",
        });
    if (v != null) campo.value = v;
    campo.disabled = !aberto;
    const botao = el("button", {
      classe: "enviar", type: "button", disabled: !aberto, texto: v != null ? "Trocar a resposta" : "Enviar",
      onclick: () => {
        let x = campo.value.trim();
        if (!x) return;
        if (p.tipo === "numero") {
          x = Number(x.replace(",", "."));
          if (!Number.isFinite(x)) return aviso("Número inválido", "Use só dígitos e vírgula.");
        }
        if (p.tipo === "link" && !/^https?:\/\//i.test(x)) x = "https://" + x;
        responder(x);
      },
    });
    tela.append(campo, botao);
  }

  if (aberto && v == null) tela.append(el("div", { classe: "painel" }, [el("b", { texto: "Sua vez" }), el("span", { texto: "Dá para trocar enquanto a pergunta estiver aberta." })]));
  else if (aberto) tela.append(el("div", { classe: "painel ok" }, [el("b", { texto: "Resposta registrada" }), el("span", { texto: "Se mudar de ideia, é só responder de novo." })]));
  else if (!revelado) tela.append(el("div", { classe: "painel" }, [el("b", { texto: "Respostas encerradas" }), el("span", { texto: "Olhe para o telão." })]));
  if (revelado && p.porque) tela.append(el("div", { classe: "painel ok" }, [el("b", { texto: p.certa != null ? `Resposta: ${LETRAS[p.certa]}` : "Comentário" }), el("span", { texto: p.porque })]));
}

async function iniciar() {
  try {
    estado.perguntas = await carregarPerguntas();
  } catch {
    $("#tela").replaceChildren(el("div", { classe: "painel aviso" }, [el("b", { texto: "Não consegui carregar as perguntas" }), el("span", { texto: "Verifique a conexão e recarregue." })]));
    return;
  }
  let recebeu = false;
  acompanhar("estado/pub", (pub) => {
    recebeu = true;
    conexao("ao vivo");
    const mudou = pub?.pergunta !== estado.pub?.pergunta;
    estado.pub = pub;
    if (mudou) {
      estado.pararRespostas && estado.pararRespostas();
      estado.respostas = {};
      if (pub?.pergunta) {
        estado.pararRespostas = acompanhar(`respostas/${pub.pergunta}`, (r) => {
          estado.respostas = r || {};
          if (estado.pub?.revelado) desenhar();
        });
      }
    }
    desenhar();
  });
  setTimeout(() => { if (!recebeu) conexao("sem conexão", true); }, 8000);
}

iniciar();
