/* ── 짬짬이 쉼 — 한글을 로마자로 ──
   신경망 목소리(js/neural-voice.js)가 쓰는 음성 모델은 한글이 아니라
   로마자를 입력으로 받는다. 그 모델이 학습할 때 쓴 표기법이 uroman 이라,
   여기서도 uroman 과 글자 하나까지 같은 결과를 내야 한다 — 표기가 어긋나면
   발음이 무너진다.

   다행히 uroman 의 한국어 처리는 순수한 표 대응이다. 음절을 초성·중성·종성으로
   쪼개 각각의 로마자를 이어 붙이면 끝이고, 연음 같은 문맥 규칙이 없다.
   ("속에" → 소ㄱ + 에 → sog + e → "soge" 처럼 이어 붙이기만 해도 맞는다.)

   아래 세 표는 uroman 을 직접 돌려 뽑아낸 것이고, 한글 음절 11,172자 전부와
   sessions.json 의 모든 문구로 uroman 과 일치함을 확인했다
   (scripts/check-roman.mjs 가 CI 에서 같은 검사를 한다).

   국어의 로마자 표기법(문화체육관광부 고시)과는 다르다는 점에 주의.
   ㅊ 은 ch 가 아니라 c, 받침 ㄱ 은 k 가 아니라 g 다. 사람이 읽을 표기가 아니라
   모델에 넣을 표기이므로, 보기 좋은 쪽이 아니라 모델이 배운 쪽을 따른다. */
var JjamRoman = (function () {
  'use strict';

  var CHO = ['g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb', 's', 'ss', '',
             'j', 'jj', 'c', 'k', 't', 'p', 'h'];

  var JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wai',
              'oe', 'yo', 'u', 'weo', 'we', 'wi', 'yu', 'eu', 'yi', 'i'];

  var JONG = ['', 'g', 'gg', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb',
              'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'c',
              'k', 't', 'p', 'h'];

  var BASE = 0xAC00;
  var LAST = 0xD7A3;

  /* 음성 모델의 어휘는 이 글자들뿐이다(vocab.json). 나머지는 모델이 모르는
     기호이므로 넘기기 전에 떨군다 — 마침표·쉼표도 여기서 사라진다. */
  var ALLOWED = " '-_abcdeghijklmnoprstuwy";

  function romanize(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var cp = text.charCodeAt(i);
      if (cp >= BASE && cp <= LAST) {
        var n = cp - BASE;
        out += CHO[Math.floor(n / 588)] +
               JUNG[Math.floor(n / 28) % 21] +
               JONG[n % 28];
      } else {
        out += text[i];
      }
    }
    return out;
  }

  /* 모델에 넣을 최종 문자열 — 소문자로 낮추고 어휘 밖 글자를 버린다.
     버린 자리는 공백으로 두지 않는다: 쉼표를 공백으로 바꾸면 원래 있던
     공백과 겹쳐 두 칸이 되고, 모델은 그것을 다른 입력으로 본다. */
  function forModel(text) {
    var r = romanize(String(text)).toLowerCase();
    var out = '';
    for (var i = 0; i < r.length; i++) {
      if (ALLOWED.indexOf(r[i]) !== -1) out += r[i];
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  return { romanize: romanize, forModel: forModel, ALLOWED: ALLOWED };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JjamRoman;
