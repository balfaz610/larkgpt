require("dotenv").config();
const express = require("express");
const axios = require("axios");
const lark = require("@larksuiteoapi/node-sdk");
const db = require("./firebase");

const app = express();
app.use(express.json());

const client = new lark.Client({
  appId: process.env.LARK_APP_ID,
  appSecret: process.env.LARK_APP_SECRET,
  disableTokenCache: false,
  domain: lark.Domain.Lark,
});

async function reply(messageId, content) {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "text", content: JSON.stringify({ text: content }) },
  });
}

app.post("/api/webhook", async (req, res) => {
  const params = req.body;

  // URL verification Lark
  if (params.type === "url_verification") {
    return res.json({ challenge: params.challenge });
  }

  if (params.header?.event_type === "im.message.receive_v1") {
    const event = params.event;
    const messageId = event.message.message_id;
    const chatId = event.message.chat_id;
    const senderId = event.sender.sender_id.user_id;
    const sessionId = chatId + senderId;

    // Hanya teks
    if (event.message.message_type !== "text") {
      await reply(messageId, "⚠️ Hanya pesan teks yang didukung.");
      return res.json({ code: 0 });
    }

    const userInput = JSON.parse(event.message.content);
    const question = userInput.text.replace("@_user_1", "").trim();

    // Bangun history dari Firestore
    const historySnapshot = await db.collection("messages")
      .where("sessionId", "==", sessionId)
      .orderBy("createdAt")
      .get();

    const prompt = [];
    historySnapshot.forEach(doc => {
      const data = doc.data();
      prompt.push({ role: "user", content: data.question });
      prompt.push({ role: "assistant", content: data.answer });
    });
    prompt.push({ role: "user", content: question });

    // Panggil OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: process.env.OPENAI_MODEL, messages: prompt },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` } }
    );

    const aiReply = response.data.choices[0].message.content.trim();

    // Simpan ke Firestore
    await db.collection("messages").add({
      sessionId, question, answer: aiReply, msgSize: question.length + aiReply.length,
      createdAt: new Date(),
    });

    await reply(messageId, aiReply);
    return res.json({ code: 0 });
  }

  res.json({ code: 2 });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () => console.log("Server jalan di http://localhost:3000"));
}

module.exports = app;
