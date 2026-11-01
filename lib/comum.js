// Utilidades compartilhadas pelas funções: CORS, conferência de login e chamada ao Gemini.

function falha(status, mensagem, detalhe) {
  const erro = new Error(mensagem);
  erro.status = status; 
  erro.mensagem = mensagem;
  erro.detalhe = detalhe;
  return erro;
}

function responder(res, status, corpo) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(corpo));
}

function responderErro(res, e) {
  const status = e && e.status ? e.status : 500;
  const corpo = { ok: false, mensagem: (e && e.mensagem) || "Erro inesperado na função." };
  if (e && e.detalhe) corpo.detalhe = e.detalhe;
  if (!e || !e.status) console.error(e);
  responder(res, status, corpo);
}

// ---------- CORS ----------
function origensPermitidas() {
  return (process.env.ORIGENS_PERMITIDAS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

// Devolve true se a resposta já foi enviada (pré-voo ou origem não autorizada).
function tratarCors(req, res) {
  const origem = req.headers.origin;
  const permitidas = origensPermitidas();
  res.setHeader("Vary", "Origin");

  const autorizada = Boolean(origem) && permitidas.includes(origem);
  if (autorizada) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  if (!autorizada) {
    responder(res, 403, { ok: false, mensagem: "Origem não autorizada. Confira a variável ORIGENS_PERMITIDAS no Vercel." });
    return true;
  }
  return false;
}

// ---------- Login ----------
// O token do Firebase é entregue ao próprio Firestore (API REST), que aplica as regras de segurança.
// Se o token for falso ou vencido, o Firestore recusa. Se a conta não estiver ativa, recusamos aqui.
async function exigirProfessorAtivo(req) {
  const projeto = process.env.FIREBASE_PROJECT_ID;
  if (!projeto) throw falha(500, "A variável FIREBASE_PROJECT_ID não está configurada no Vercel.");

  const cabecalho = req.headers.authorization || "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
  if (!token) throw falha(401, "Entre no sistema para usar a IA.");

  let dados;
  try {
    dados = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch (e) {
    throw falha(401, "Sessão inválida. Entre de novo.");
  }

  const uid = dados.user_id || dados.sub;
  if (!uid || dados.aud !== projeto || !/^[A-Za-z0-9_-]{6,128}$/.test(uid)) {
    throw falha(401, "Sessão inválida. Entre de novo.");
  }

  const resposta = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/users/${uid}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (resposta.status === 401 || resposta.status === 403) {
    throw falha(401, "Sua sessão expirou ou não é válida. Entre de novo.");
  }
  if (!resposta.ok) throw falha(502, "Não foi possível conferir a sua conta agora.");

  const documento = await resposta.json();
  const campos = documento.fields || {};
  if (!campos.ativo || campos.ativo.booleanValue !== true) {
    throw falha(403, "Sua conta não está ativa.");
  }
  return {
    uid,
    nome: (campos.nome && campos.nome.stringValue) || "",
    cargo: (campos.cargo && campos.cargo.stringValue) || "professor"
  };
}

// ---------- Gemini ----------
async function chamarGemini({ instrucao, partes, esquema }) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw falha(500, "A variável GEMINI_API_KEY não está configurada no Vercel.");
  const modelo = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  let resposta;
  try {
    resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instrucao }] },
          contents: [{ role: "user", parts: partes }],
          generationConfig: { responseMimeType: "application/json", responseSchema: esquema }
        })
      }
    );
  } catch (e) {
    throw falha(502, "Não consegui falar com a IA agora. Tente de novo em instantes.");
  }

  let corpo = null;
  try {
    corpo = await resposta.json();
  } catch (e) {
    corpo = null;
  }

  if (!resposta.ok) {
    const mensagemGoogle = corpo && corpo.error ? corpo.error.message : "";
    if (resposta.status === 429) {
      throw falha(429, "O limite gratuito da IA foi atingido por agora. Tente de novo em alguns minutos.", mensagemGoogle);
    }
    throw falha(502, "A IA recusou o pedido.", mensagemGoogle);
  }

  const candidato = corpo && corpo.candidates && corpo.candidates[0];
  const partesResposta = candidato && candidato.content && candidato.content.parts;
  const texto = partesResposta
    ? partesResposta.filter((p) => !p.thought).map((p) => p.text || "").join("").trim()
    : "";
  if (!texto) {
    throw falha(502, "A IA não devolveu resposta. Tente de novo.", candidato && candidato.finishReason);
  }

  try {
    return JSON.parse(texto);
  } catch (e) {
    throw falha(502, "A IA devolveu uma resposta fora do formato. Tente de novo.");
  }
}

module.exports = { falha, responder, responderErro, tratarCors, exigirProfessorAtivo, chamarGemini };
