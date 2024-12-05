import {ref, set, push, get}
  from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

// ---GeminiAI 読み込み
import {GoogleGenerativeAI} from "@google/generative-ai";
// Access your API key as an environment variable (see "push up your API key" above)
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
// The Gemini 1.5 models are versatile and work with both text-only and multimodal prompts
const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
const aiPrompt = `
以下の条件に従って、散歩の目的地を見つけるための質問を作成してください。
- 質問はユーザーが答えやすい形式にする。
- 3つの選択肢 (a, b, c) を提供する。
- 質問は3回まで。
- 一つのメッセージにつき、質問は一つ。
- 選択肢は具体的な場所やカテゴリを指す内容とする。
- 選択肢と質問をそれぞれ<p>タグで囲む。
- 例: <p>あなたの好みの雰囲気はどれですか？</p> <p>a. 静かな公園</p> <p>b. おしゃれなカフェ通り</p> <p>c. 歴史ある街並み</p>
`;

// ---GoogleMap API読み込み
import {normalize} from '@geolonia/normalize-japanese-addresses';
const script = $('<script>')
  .attr('src', `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAP_API_KEY}&libraries=places`)
  .attr('async', true) // deferも追加
  .attr('defer', true) // deferも追加
  .attr('loading', 'lazy') // 推奨属性
  .appendTo('head');

script.onload = () => {
  console.log("Google Maps API loaded successfully!");
  // ここにAPIを利用するコードを追加
};
script.onerror = () => {
  console.error("Failed to load Google Maps API");
};

// チャットの進行具合管理
let step = 1;
// 目的地検索の回数管理
// let searchNum = 1;
// 固有のメッセージID
let messageId;
// メッセージ内容一時記録
const sessions = {};
// ボタンを押せるか挙動設定
let btnFlag = false;
// 位置情報保持
let currentPosition = new Object();


// ---全体の流れ
$(function () {
  getLocationInfo();
  initMsg();
  // 選択肢のボタンを押した時の挙動
  $('.select-btn').on("click", function () {
    if (btnFlag === true) {
      sendAnswer(this.value);
    } else {
      return;
    }
  });
});


// ---AIプロンプト---
// AI初期メッセージ
async function initMsg () {
  const result = await model.generateContent(aiPrompt);
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
    ${aiPrompt}
  `;
  const sessionRef = ref(window.db, "sessions/step" + step + "-" + messageId);
  const result = await model.generateContent(replyPrompt);
  const nextQuestion = result.response.text();
  const aiResponse = {
    text: nextQuestion,
  };
  if (!sessions["step" + step + "-" + messageId]) {
    sessions["step" + step + "-" + messageId] = {};
  }
  // 質問をデータベースに保存
  sessions["step" + step + "-" + messageId].id = "sessions/step" + step + "-" + messageId;
  sessions["step" + step + "-" + messageId].aiResponse = aiResponse.text;
  await set(sessionRef, sessions["step" + step + "-" + messageId]);
  // AIの返信を画面に表示
  createAiMsg(nextQuestion);
}

// 目的地(カテゴリ)の提案
async function suggestCategory () {
  step++;
  const history = await fetchAllSessionHistory(); // Firebaseから履歴を取得
  // console.log(history);
  const categoryPrompt = `
    以下はこれまでのユーザーの回答です。
    1つ目の質問: ${history["step1"].aiResponse}
    回答: ${history["step1"].userResponse}
    2つ目の質問: ${history["step2"].aiResponse}
    回答: ${history["step2"].userResponse}
    3つ目の質問: ${history["step3"].aiResponse}
    回答: ${history["step3"].userResponse}

    これらの情報を元にカテゴリを提案してください。
    - 提案内容は次の形式にする:
      カテゴリ: <カテゴリ名>
    - カテゴリは「カフェ、公園、史跡、商店街、その他」から選ぶ。
    - カテゴリを囲むpタグには"category"クラスをつける
    - カテゴリ以外の文章を含めない
`;

  const queryPrompt = `
    以下はこれまでのユーザーの回答です。
    1つ目の質問: ${history["step1"].aiResponse}
    回答: ${history["step1"].userResponse}
    2つ目の質問: ${history["step2"].aiResponse}
    回答: ${history["step2"].userResponse}
    3つ目の質問: ${history["step3"].aiResponse}
    回答: ${history["step3"].userResponse}

    これらの情報を元に、Google Maps Places APIに適したクエリを提案してください。
    - 提案内容は次の形式にする:
      具体的な検索キーワード
    - クエリはGoogle Maps Places APIの検索にそのまま使用できる具体的なフレーズ。
    - クエリは" , "区切りで出力すること
    - クエリ以外の文章を含めない
`;

  const sessionRef = ref(window.db, "sessions/step" + step + "-" + messageId);
  const resultCategory = await model.generateContent(categoryPrompt);
  const category = resultCategory.response.text();
  const resultQuery = await model.generateContent(queryPrompt);
  const query = resultQuery.response.text();
  const aiResponse = {
    category: category
  };
  if (!sessions["step" + step + "-" + messageId]) {
    sessions["step" + step + "-" + messageId] = {};
  }
  sessions["step" + step + "-" + messageId].category = aiResponse.category;
  await set(sessionRef, sessions["step" + step + "-" + messageId]);
  console.log("category", category);
  console.log("query", query);
  searchPlaces(query);
}

// ---Google Map API
// const directionService = new google.maps.DirectionsService();
// await directionService.route

let searchRadius = 3000; // 初期半径
function searchPlaces(query, retryCount = 0) {
  step++;
  const mapElement = document.querySelector('#map');
  if (!mapElement) {
    console.error("The map container element was not found.");
    return;
  }

  const service = new google.maps.places.PlacesService(mapElement);

  const request = {
    query: query,
    fields: ['name', 'place_id', 'geometry'],
    location: new google.maps.LatLng(currentPosition.lat, currentPosition.lng),
    radius: searchRadius, // 半径を設定
  };
  
  let message = `
  <div class="ai-msg msg result">
    <p>あなたにおすすめの散歩の目的地は…</p>
    <p>検索条件： ${query}</p>
    <ul></ul>
  </div>
  `;
  $('.contents').append(message);

  service.textSearch(request, (results, status) => {
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      for (let i = 0; i < results.length; i++) {
        const place = results[i];
        const contentString = '<li>' + place.name + '</li>';
        $('.msg.result ul').append(contentString);
      }
    } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS && retryCount < 5) {
      searchRadius += 5000; // 半径を拡大
      searchPlaces(query, retryCount + 1);
    } else {
      createAiMsg(`<p>指定した条件では結果が見つかりませんでした。<br>検索を終了します。</p>`);
    }
  });
};



// ---チャット機能---
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
  for (let n = 1; n < step; n++) {
    const sessionRef = await ref(window.db, "sessions/step" + n + "-" + messageId);
    const snapshot = await get(sessionRef);
    await new Promise(resolve => setTimeout(resolve, 500));  // 500ms待機

    if (snapshot.exists()) {
      let index = "step" + n;
      sessionArr[index] = snapshot.val();
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
    replyAiMsg(userAnswer);
  } else {
    suggestCategory();
  }
}

// ---ユーザー情報---
// ID生成
function generateId () {
  return Math.floor(Math.random() * 1000 + 1);
}

// 位置情報取得
function getLocationInfo () {
  let locationInfo = confirm('目的地の提案のために現在地の取得が必要です。\n位置情報は目的地の提案が終了次第削除されます。\nまた、許可しない場合は入力もできます。\n現在地の取得を許可しますか？');
  if (locationInfo) {
    navigator.geolocation.getCurrentPosition(
      function (position) {
        currentPosition.lat = position.coords.latitude;
        currentPosition.lng = position.coords.longitude;
      },
      function (error) {
        console.error("エラー: " + error.message);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 0
      }
    );
  } else {
    while (locationInfo === "" || locationInfo === false) {
      locationInfo = prompt("必須入力です。\n目的地の提案に使う住所を町名まで入力してください。");
      if (locationInfo !== "") {
        normalize(locationInfo).then(result => {
          console.log(result);
          currentPosition.lat = result.point.lat;
          currentPosition.lng = result.point.lng;
        });
        break;
      };
      alert("入力が確認できませんでした。もう一度入力してください。");
    }
  }
  console.log(currentPosition);

  return locationInfo;
}