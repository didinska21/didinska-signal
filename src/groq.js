/**
 * Wrapper pemanggilan Groq API (OpenAI-compatible chat completion).
 * Model disarankan: "llama-3.3-70b-versatile" (cepat & kuat untuk penalaran singkat)
 * Cek model terbaru yang tersedia di https://console.groq.com/docs/models
 */

const SYSTEM_PROMPT = `Anda adalah analis teknikal dan ahli perdagangan futures profesional.
Tugas Anda adalah menganalisis data indikator teknikal yang diberikan dan menghasilkan
sinyal trading yang objektif dan berbasis data.

Gunakan bahasa Indonesia yang profesional, ringkas, dan langsung pada intinya.

Format WAJIB jawaban (gunakan struktur ini persis):
📊 Bias Arah: (Bullish / Bearish / Netral)
📍 Level Kunci: (Support & Resistance utama, sebutkan angka)
🎯 Skenario Entry: (Area harga potensial untuk Long/Short)
🛡️ Manajemen Risiko: (Stop-Loss & Take-Profit yang logis, sebutkan angka)

Akhiri selalu dengan satu kalimat peringatan singkat bahwa ini adalah analisis probabilitas
matematis dan risiko sepenuhnya ditanggung oleh trader.
Jangan menambahkan basa-basi di luar format ini.`;

export async function generateSignal(env, symbol, indicatorSummary) {
  const userPrompt = `Simbol: ${symbol}
Timeframe: ${env.INTERVAL}

Data indikator terkini:
- Harga terakhir (close): ${indicatorSummary.lastClose}
- EMA 20: ${indicatorSummary.ema20.toFixed(2)}
- EMA 50: ${indicatorSummary.ema50.toFixed(2)}
- RSI 14: ${indicatorSummary.rsi14.toFixed(2)}
- MACD: ${indicatorSummary.macd.macd.toFixed(4)} | Signal: ${indicatorSummary.macd.signal.toFixed(4)} | Histogram: ${indicatorSummary.macd.histogram.toFixed(4)}
- ATR 14: ${indicatorSummary.atr14.toFixed(2)}
- Bollinger Bands: Upper ${indicatorSummary.bollinger.upper.toFixed(2)} | Mid ${indicatorSummary.bollinger.mid.toFixed(2)} | Lower ${indicatorSummary.bollinger.lower.toFixed(2)}
- Support terdekat: ${indicatorSummary.support}
- Resistance terdekat: ${indicatorSummary.resistance}

Susun analisis sesuai format yang ditentukan.`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}
