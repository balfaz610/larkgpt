require("dotenv").config();
const express = require("express");
const axios = require("axios");
const lark = require("@larksuiteoapi/node-sdk");
const db = require("./firebase");

const app = express();
app.use(express.json());

const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;
const OPENAI_KEY = process.env.OPENAI_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const OPENAI_MAX_TOKEN = parseInt(process.env.OPENAI_MAX_TOKEN) || 1024;

const client = new lark.Client({
  appId: LARK_APP_ID,
  appSecret: LARK_APP_SECRET,
  disableTokenCache: false,
  domain: lark.Domain.Lark,
});

async function reply(messageId, content) {
  try {
    await client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: content }),
      },
    });
  } catch (err) {
    console.error("Reply error:", err);
  }
}

async function getConversation(sessionId) {
  const snapshot = await db.collection("messages")
    .where("sessionId", "==", sessionId)
    .orderBy("createdAt")
    .get();

  const messages = [];
  snapshot.forEach((doc) => {
    const d = doc.data();
    messages.push({ role: "user", content: d.question });
    messages.push({ role: "assistant", content: d.answer });
  });
  return messages;
}

async function saveConversation(sessionId, question, answer) {
  await db.collection("messages").add({
    sessionId,
    question,
    answer,
    msgSize: question.length + answer.length,
    createdAt: new Date(),
  });
}

async function getOpenAIReply(prompt) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: OPENAI_MODEL, messages: prompt },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}` } }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI Error:", err.response?.data || err.message);
    return "⚠️ Error: gagal menghubungi AI.";
  }
}

app.post("/api/webhook", async (req, res) => {
  const params = req.body;

  // Step 1: verifikasi webhook URL
  if (params.type === "url_verification") {
    return res.json({ challenge: params.challenge });
  }

  // Step 2: proses pesan masuk
  if (params.header?.event_type === "im.message.receive_v1") {
    const event = params.event;
    const messageId = event.message.message_id;
    const chatId = event.message.chat_id;
    const senderId = event.sender.sender_id.user_id;
    const sessionId = chatId + senderId;

    const messageType = event.message.message_type;
    if (messageType !== "text") {
      await reply(messageId, "⚠️ Hanya pesan teks yang didukung.");
      return res.json({ code: 0 });
    }

    const userInput = JSON.parse(event.message.content);
    const question = userInput.text.replace("@_user_1", "").trim();

    if (question === "/clear") {
      const snapshot = await db.collection("messages")
        .where("sessionId", "==", sessionId).get();
      snapshot.forEach(async (doc) => await doc.ref.delete());
      await reply(messageId, "✅ Riwayat percakapan telah dihapus.");
      return res.json({ code: 0 });
    }

    // bangun history
    const prompt = await getConversation(sessionId);
    prompt.push({ role: "user", content: question });

    // panggil AI
    const aiResponse = await getOpenAIReply(prompt);

    // simpan dan balas
    await saveConversation(sessionId, question, aiResponse);
    await reply(messageId, aiResponse);

    return res.json({ code: 0 });
  }

  res.json({ code: 2 });
});

// Start lokal (buat dev)
if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () => console.log("Server jalan di http://localhost:3000"));
}

module.exports = app;
