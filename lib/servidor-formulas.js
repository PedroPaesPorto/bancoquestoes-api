// Padroniza e confere fórmulas.
// Formato do sistema: \( ... \) no meio do texto, \[ ... \] em destaque, \ce{...} para química.
// Aceita e converte formatos comuns que vêm de IA ou de textos copiados:
//   $x^2$  e  $$ ... $$   →  \( x^2 \)  e  \[ ... \]
//   \\( ... \\)           →  \( ... \)     (barras duplicadas)
//   \frac{1}{2}, \sqrt{x}, \ce{H2O} soltos no texto → envolvidos em \( \)
// O símbolo $ de valores em reais (R$ 5,00) é preservado.
// Também repara um defeito comum de JSON: \frac, \times, \beta e \neq com uma barra só viram
// caracteres de controle (\f, \t, \b, \n) e a fórmula some. Dentro de \( \) e \[ \] eles voltam ao normal.

const PADRAO_DELIMITADOR = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;

const COMANDOS_SOLTOS = [
  /\\ce\{(?:[^{}]|\{[^{}]*\})*\}/g,
  /\\frac\{[^{}]*\}\{[^{}]*\}/g,
  /\\sqrt(?:\[[^\]]*\])?\{[^{}]*\}/g
];

function pareceFormula(conteudo, antes, depois) {
  if (!conteudo || conteudo.includes("\n") || /^\s|\s$/.test(conteudo)) return false;
  if (antes && /[A-Z]/.test(antes)) return false; // R$, US$, A$...
  if (depois && /\d/.test(depois)) return false;
  return /[\\^_{}=+\-*/<>|]/.test(conteudo) || /^[A-Za-z]$/.test(conteudo) || /^\d+([.,]\d+)?$/.test(conteudo);
}

function converterCifroes(texto) {
  let saida = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "$" && texto[i - 1] !== "\\") {
      const fim = texto.indexOf("$", i + 1);
      if (fim > i + 1 && fim - i - 1 <= 200) {
        const conteudo = texto.slice(i + 1, fim);
        if (pareceFormula(conteudo, texto[i - 1], texto[fim + 1])) {
          saida += `\\(${conteudo}\\)`;
          i = fim + 1;
          continue;
        }
      }
    }
    saida += c;
    i++;
  }
  return saida;
}

function envolverComandosSoltos(trecho) {
  let t = trecho;
  COMANDOS_SOLTOS.forEach((padrao) => {
    t = t.replace(padrao, (m) => `\\(${m}\\)`);
  });
  return t;
}

// Dentro das fórmulas, devolve às barras invertidas os caracteres de controle que as substituíram.
function repararControles(texto) {
  if (!/[\u0008\u0009\u000C\u000D]|\n[a-zA-Z]/.test(texto)) return texto;
  const padrao = new RegExp(PADRAO_DELIMITADOR.source, "g");
  const dentro = texto.replace(padrao, (trecho) =>
    trecho
      .replace(/\u000C/g, "\\f")
      .replace(/\u0009/g, "\\t")
      .replace(/\u0008/g, "\\b")
      .replace(/\u000D/g, "\\r")
      .replace(/\n(?=[a-zA-Z])/g, "\\n")
  );
  // Fora das fórmulas, só restaura quando o caractere vem seguido de um comando LaTeX conhecido.
  return dentro
    .replace(/\u000C(?=rac\{)/g, "\\f")
    .replace(/\u0009(?=(imes|ext\{|heta|au)\b|ext\{)/g, "\\t")
    .replace(/\u0008(?=(eta|egin\{|ar\{))/g, "\\b")
    .replace(/\u000D(?=(ight|ho)\b)/g, "\\r");
}

function normalizarFormulas(entrada) {
  if (typeof entrada !== "string" || entrada === "") return entrada || "";
  let t = repararControles(entrada);

  // 1. Barras duplicadas, só quando não há nenhum delimitador correto no texto.
  if (!/(^|[^\\])\\[(\[]/.test(t)) {
    t = t.replace(/\\\\([()[\]])/g, "\\$1");
  }

  // 2. $$ ... $$ e $ ... $
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (m, c) => `\\[${c.trim()}\\]`);
  t = converterCifroes(t);

  // 3. Comandos soltos fora de qualquer fórmula
  const partes = [];
  let ultimo = 0;
  let achado;
  const padrao = new RegExp(PADRAO_DELIMITADOR.source, "g");
  while ((achado = padrao.exec(t)) !== null) {
    partes.push(envolverComandosSoltos(t.slice(ultimo, achado.index)));
    partes.push(achado[0]);
    ultimo = padrao.lastIndex;
  }
  partes.push(envolverComandosSoltos(t.slice(ultimo)));
  return partes.join("");
}

// Lista as fórmulas de um texto: [{ expressao, destaque }]
function extrairFormulas(texto) {
  const lista = [];
  const padrao = new RegExp(PADRAO_DELIMITADOR.source, "g");
  let achado;
  while ((achado = padrao.exec(String(texto || ""))) !== null) {
    const destaque = achado[1] !== undefined;
    lista.push({ expressao: destaque ? achado[1] : achado[2], destaque });
  }
  return lista;
}

module.exports = { normalizarFormulas, extrairFormulas, PADRAO_DELIMITADOR };
