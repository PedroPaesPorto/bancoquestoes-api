// Função de teste: confere se a chave do Gemini funciona e quais modelos "Flash" ela enxerga.
// Ela NÃO mostra a chave. Apague este arquivo depois de usar.

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const chave = process.env.GEMINI_API_KEY;
  if (!chave) {
    res.status(200).send(JSON.stringify({
      ok: false,
      erro: "A variável GEMINI_API_KEY não está configurada no Vercel."
    }, null, 2));
    return;
  }

  const modelo = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const resultado = {
    ok: false,
    formatoDaChave: chave.startsWith("AQ.") ? "AQ. (formato novo)" : chave.startsWith("AIza") ? "AIza (formato antigo)" : "outro formato",
    modeloTestado: modelo,
    etapas: {}
  };

  // 1. Lista os modelos Flash que aceitam generateContent
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": chave }
    });
    const corpo = await r.json();
    resultado.etapas.listarModelos = { status: r.status };
    if (r.ok) {
      resultado.modelosFlash = (corpo.models || [])
        .filter((m) => /flash/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace("models/", ""));
    } else {
      resultado.etapas.listarModelos.erro = corpo.error
        ? { codigo: corpo.error.status, mensagem: corpo.error.message }
        : "Resposta inesperada";
    }
  } catch (e) {
    resultado.etapas.listarModelos = { erro: String(e.message || e) };
  }

  // 2. Pede uma resposta curtinha ao modelo
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Responda apenas com a palavra: funcionando" }] }]
      })
    });
    const corpo = await r.json();
    resultado.etapas.gerarTexto = { status: r.status };
    if (r.ok) {
      const partes = corpo.candidates && corpo.candidates[0] && corpo.candidates[0].content && corpo.candidates[0].content.parts;
      resultado.respostaDoModelo = partes ? partes.map((p) => p.text || "").join("").trim() : "(sem texto)";
      resultado.ok = true;
    } else {
      resultado.etapas.gerarTexto.erro = corpo.error
        ? { codigo: corpo.error.status, mensagem: corpo.error.message }
        : "Resposta inesperada";
    }
  } catch (e) {
    resultado.etapas.gerarTexto = { erro: String(e.message || e) };
  }

  res.status(200).send(JSON.stringify(resultado, null, 2));
};
