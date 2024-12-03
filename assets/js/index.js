import {GoogleGenerativeAI} from "@google/generative-ai";
import {ref, set, push, get}
  from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";
// Access your API key as an environment variable (see "push up your API key" above)
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
// The Gemini 1.5 models are versatile and work with both text-only and multimodal prompts
const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
const prompt = `
    以下の条件に従って質問を行い、散歩の目的地を提案してください:
    ・質問と選択肢だけの文章を作る。
    ・質問ごとに小文字のA・B・Cの3つの選択肢を表示する。
    ・選択肢の回答結果に応じて次の質問を考える。
    ・最終的にカテゴリ（例：公園、史跡）で提案する。
    ・冒頭の文章と選択肢をそれぞれpタグで囲う。
    ・質問文に数字をつけない。
    ・一度のメッセージに質問は1つまで。
  `;
let step = 1;
let messageId;
const sessions = {};
// ボタンを押せるか挙動設定
let btnFlag = true;

// 全体の流れ
$(function () {
  initMsg();
  // 送信ボタンクリック・エンターキー押した時の挙動
  $('.select-btn').on("click", function () {
    if (btnFlag === true) {
      sendAnswer(this.value);
    } else {
      return;
    }
  });
});


// ---要素挿入---
// AIメッセージ要素作成
function createAiMsg (aiMsg) {
  let message = `
  <div class="ai-msg msg">
    ${aiMsg}
  </div>
  `;
  $('.contents').append(message);
  btnFlag = true;
}
// ユーザーメッセージ要素作成
function createUserMsg (sendAnswer) {
  let message = `
  <div class="user-msg msg">
    <p>${sendAnswer}</p>
  </div>
  `;
  $('.contents').append(message);
}

// ---AIプロンプト---
// AI初期メッセージ
async function initMsg () {
  const result = await model.generateContent(prompt);
  const question = result.response.text();
  const id = generateId();
  messageId = id;
  const sessionRef = ref(window.db, "sessions/step" + step + "-" + messageId);
  const aiResponse = {
    text: question,
  };
  // 質問をデータベースに保存
  if (!sessions["step" + step + "-" + messageId]) {
    sessions["step" + step + "-" + messageId] = {};
  }
  sessions["step" + step + "-" + messageId].id = "sessions/step" + step + "-" + messageId;
  sessions["step" + step + "-" + messageId].aiResponse = aiResponse.text;
  await set(sessionRef, sessions["step" + step + "-" + messageId]);
  createAiMsg(question);
  console.log(messageId);
  return id;
}

// AIからの返信
async function replyAiMsg (userAnswer) {
  step++;
  const history = await fetchSessionHistory(); // Firebaseから履歴を取得する関数を実装
  const replyPrompt = `
    以下は現在の会話の履歴です:
    前回の質問:${history.aiResponse}
    ユーザーの最新回答: ${userAnswer}
    この情報をもとに、次の質問を生成してください。
    ${prompt}
  `;
  const sessionRef = ref(window.db, "sessions/step" + step + "-" + messageId);
  const result = await model.generateContent(replyPrompt);
  const nextQuestion = result.response.text();
  const aiResponse = {
    text: nextQuestion,
  };
  // 質問をデータベースに保存
  if (!sessions["step" + step + "-" + messageId]) {
    sessions["step" + step + "-" + messageId] = {};
  }
  sessions["step" + step + "-" + messageId].id = "sessions/step" + step + "-" + messageId;
  sessions["step" + step + "-" + messageId].aiResponse = aiResponse.text;
  await set(sessionRef, sessions["step" + step + "-" + messageId]);
  // AIの返信を画面に表示
  createAiMsg(nextQuestion);
}

// 目的地の提案
async function suggestCategory () {
  step++;
  const history = await fetchSessionHistory(); // Firebaseから履歴を取得
  const prompt = `
    1つ目の質問:${sessions["step1-" + messageId].aiResponse}
    回答:${sessions["step1-" + messageId].userResponse}
    2つ目の質問:${sessions["step2-" + messageId].aiResponse}
    回答:${sessions["step2-" + messageId].userResponse}
    3つ目の質問:${sessions["step3-" + messageId].aiResponse}
    回答:${sessions["step3-" + messageId].userResponse}
    上記の情報を基に、適切な散歩の目的地を提案してください。
    以下の条件に従ってください。
    ・カテゴリで提案する。（例: 公園、史跡）
    ・数字をつけた目的地1つ1つを<p></p>で囲う。
    ・3つまで提案する。
    ・シンプルな文章。
  `;
  const sessionRef = ref(window.db, "sessions/step" + step + "-" + messageId);
  const result = await model.generateContent(prompt);
  const destination = result.response.text();
  const aiResponse = {
    result: destination,
  };
  if (!sessions["step" + step + "-" + messageId]) {
    sessions["step" + step + "-" + messageId] = {};
  }
  sessions["step" + step + "-" + messageId].result = aiResponse.result;
  console.log(sessions["step" + step + "-" + messageId]);
  await set(sessionRef, sessions["step" + step + "-" + messageId]);
  let message = `
  <div class="ai-msg msg last">
    <p>あなたにおすすめの散歩の目的地は…</p>
    ${sessions["step" + step + "-" + messageId].result}
  </div>
  `;
  $('.contents').append(message);
  
  suggestDestination();
}

async function suggestDestination() {
  const history = await fetchAllSessionHistory(); // Firebaseから履歴を取得
  console.log(history);
}

// ---その他の関数---
// 会話履歴取得
async function fetchSessionHistory () {
  let tmp = step;
  tmp--;
  const sessionRef = await ref(window.db, "sessions/step" + tmp + "-" + messageId);
  const snapshot = await get(sessionRef);
  await new Promise(resolve => setTimeout(resolve, 500));  // 500ms待機

  if (snapshot.exists()) {
    const history = snapshot.val();
    return history;
  } else {
    console.log("No chat history found.");
    return null;
  }
}

// 会話履歴を全て取得する
async function fetchAllSessionHistory () {
  const sessionArr = {};
  for (let n = 1; n < 5; n++) {
    const sessionRef = await ref(window.db, "sessions/step" + n + "-" + messageId);
    const snapshot = await get(sessionRef);
    await new Promise(resolve => setTimeout(resolve, 500));  // 500ms待機

    if (snapshot.exists()) {
      let step = "step" + n;
      console.log(step, snapshot.val());
      // const history = snapshot.val();
      sessionArr[step] = snapshot.val();
      // console.log(sessionArr);
    } else {
      console.log("No chat history found.");
      return null;
    }
  }
  return sessionArr;
}



// 送信
async function sendAnswer (answer) {
  btnFlag = false;
  let userAnswer = answer;
  createUserMsg(userAnswer);
  const sessionRef = ref(window.db, "sessions/step" + step + "-" + messageId);
  const userResponse = {
    text: userAnswer,
  };
  if (!sessions["step" + step + "-" + messageId]) {
    sessions["step" + step + "-" + messageId] = {};
  }
  sessions["step" + step + "-" + messageId].userResponse = userResponse.text;
  await set(sessionRef, sessions["step" + step + "-" + messageId]);

  if (step < 3) {
    setTimeout(() => {
      replyAiMsg(userAnswer);
    }, 500);
  } else {
    setTimeout(() => {
      suggestCategory();
    }, 500);
  }
}

// ID生成
function generateId () {
  return Math.floor(Math.random() * 1000 + 1);
}