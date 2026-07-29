/* ===================================================================
   짬짬이 사이트 전환 — 헤더에 자매 사이트 세 개를 바로 놓는다
   ===================================================================
   짬짬이 게임·퀴즈·영상·이야기는 저장소가 넷으로 갈라져 있지만 선생님에게는
   "자투리 시간에 쓰는 짬짬이" 하나다. 지금은 한 곳에 들어오면 나머지 셋이
   있다는 걸 알 방법이 없어서, 헤더에서 곧바로 건너갈 수 있게 한다.

   모양은 [아이콘 + 그 아래 이름] 세 벌. 아이콘만 두는 안도 검토했지만,
   처음 보는 사람은 그 그림이 "다른 사이트로 가는 것"인 줄 모른다.
   (구글의 점 아홉 개처럼 이미 학습된 기호가 아니다.) 그래서 이름을 붙였다.

   쓰는 법 — 헤더 오른쪽 버튼 줄 안에 host 를 하나 놓고 이 파일을 불러온다.

     <div class="jjam-switch" data-site="game"></div>
     <script src="shared/jjam-switcher.js" defer></script>

   data-site 는 "지금 있는 곳"이다(game | quiz | video | story).
   그 항목은 빠지고 나머지 셋만 그려진다.

   이 파일은 네 저장소에서 글자 하나까지 같아야 한다.
   고칠 때는 jjam(상류)에서 고친 뒤 나머지 셋에서 `sync:shared` 를 돌린다.

   스타일·아이콘까지 이 파일 안에 들어 있다. 네 사이트의 CSS 가 서로 다른
   구조라서, 각 CSS 에 같은 규칙을 네 번 복사해 두면 또 어긋나기 때문이다.
   =================================================================== */

(function () {
  'use strict';

  // label — 화면에 보이는 이름. 넷의 폭을 맞추려고 띄어쓰기를 넣지 않았다.
  // go    — 화면 낭독기가 읽는 문장. 조사(으로/로)가 이름마다 달라 통째로 적는다.
  var SITES = [
    { key: 'game',  label: '짬짬이게임',   go: '짬짬이 게임으로 가기',
      url: 'https://shway81-droid.github.io/jjam/' },
    { key: 'quiz',  label: '짬짬이퀴즈',   go: '짬짬이 퀴즈로 가기',
      url: 'https://shway81-droid.github.io/jjam-quiz/' },
    { key: 'video', label: '짬짬이영상',   go: '짬짬이 영상으로 가기',
      url: 'https://shway81-droid.github.io/jjam-video/' },
    { key: 'story', label: '짬짬이이야기', go: '짬짬이 이야기로 가기',
      url: 'https://shway81-droid.github.io/jjam-story/' }
  ];

  // 각 사이트의 favicon.svg 와 같은 그림 — 둥근 타일 + 우상단 "자투리 시간" 시계 배지.
  // 다른 사이트의 파일을 가져올 수는 없으므로(오프라인·교차 출처) 여기에 넣는다.
  var BADGE =
    '<circle cx="76" cy="24" r="14" fill="#FFFFFF"/>' +
    '<path d="M76 15.5 V24.5 L82.5 28.5" fill="none" stroke="#152447" ' +
    'stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>';

  var ART = {
    game:
      '<rect width="100" height="100" rx="24" fill="#FFB703"/>' +
      '<circle cx="44" cy="58" r="30" fill="#152447"/>' +
      '<path d="M37 44 L37 72 L61 58 Z" fill="#FFB703"/>' + BADGE,
    quiz:
      '<rect width="100" height="100" rx="24" fill="#12A57C"/>' +
      '<circle cx="44" cy="58" r="30" fill="#FFFFFF"/>' +
      '<path d="M34 49 A11 11 0 1 1 45 60 L45 64" fill="none" stroke="#12A57C" ' +
      'stroke-width="7.4" stroke-linecap="round"/>' +
      '<circle cx="45" cy="73.5" r="4.4" fill="#12A57C"/>' + BADGE,
    video:
      '<rect width="100" height="100" rx="24" fill="#4FA8E8"/>' +
      '<rect x="14" y="44" width="60" height="36" rx="7" fill="#FFFFFF"/>' +
      '<path d="M21 44 H67 A7 7 0 0 1 74 51 V58 H14 V51 A7 7 0 0 1 21 44 Z" fill="#152447"/>' +
      '<path d="M28 44 L22 58 M44 44 L38 58 M60 44 L54 58" fill="none" stroke="#FFFFFF" ' +
      'stroke-width="4.4" stroke-linecap="round"/>' + BADGE,
    story:
      '<rect width="100" height="100" rx="24" fill="#6145B5"/>' +
      '<path d="M17 43c8.5-4.5 17-4.5 26 0v37c-9-4.5-17.5-4.5-26 0z" fill="#FFFFFF"/>' +
      '<path d="M71 43c-8.5-4.5-17-4.5-26 0v37c9-4.5 17.5-4.5 26 0z" fill="#E8DEFF"/>' + BADGE
  };

  var CSS = [
    /* host 는 헤더 버튼 줄의 flex 자식 하나다. 안쪽 배치는 스스로 책임진다. */
    '.jjam-switch{position:relative;display:flex;align-items:center;gap:8px;flex:none}',
    '.jjam-switch[hidden]{display:none}',
    '.jjam-switch-sep{width:1px;height:30px;background:rgba(255,255,255,.28);margin:0 3px;flex:none}',
    '.jjam-switch-btn{display:inline-flex;flex-direction:column;align-items:center;gap:4px;',
    'padding:6px 8px 5px;border-radius:12px;background:transparent;border:1px solid transparent;',
    'text-decoration:none;cursor:pointer;font:inherit;transition:background .12s,transform .1s}',
    '.jjam-switch-btn svg{width:34px;height:34px;display:block;flex:none}',
    '.jjam-switch-btn span{font-size:11px;font-weight:700;line-height:1;white-space:nowrap;color:#fff}',
    '.jjam-switch-btn:hover{background:rgba(255,255,255,.14)}',
    '.jjam-switch-btn:active{transform:translateY(1px)}',
    '.jjam-switch-btn:focus-visible{outline:3px solid #FFD34D;outline-offset:2px}',
    /* 오프라인 — 다른 사이트는 저장소가 따로라 캐시가 없다. 눌러도 못 간다. */
    '.jjam-switch.is-offline .jjam-switch-btn{opacity:.45}',
    '.jjam-switch.is-offline .jjam-switch-btn:hover{background:transparent}',
    '.jjam-switch-note{position:absolute;top:100%;right:0;margin-top:6px;z-index:30;',
    'background:#1C2333;color:#fff;font-size:13px;font-weight:600;line-height:1.4;',
    'padding:8px 13px;border-radius:9px;white-space:nowrap;box-shadow:0 6px 16px rgba(8,14,32,.32)}',
    '.jjam-switch-note[hidden]{display:none}',
    '@media (prefers-reduced-motion:reduce){.jjam-switch-btn{transition:none}}',
    /* 좁은 화면에서는 이름을 줄이지 않고 아이콘만 남긴다 — 잘린 글자보다 낫다. */
    '@media (max-width:720px){.jjam-switch-btn span{display:none}',
    '.jjam-switch-btn{padding:6px}.jjam-switch-sep{height:26px}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('jjam-switch-css')) return;
    var el = document.createElement('style');
    el.id = 'jjam-switch-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function iconSvg(key) {
    return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' + ART[key] + '</svg>';
  }

  function render(host) {
    var current = host.getAttribute('data-site');
    var html = '<span class="jjam-switch-sep" aria-hidden="true"></span>';

    SITES.forEach(function (s) {
      if (s.key === current) return;
      html += '<a class="jjam-switch-btn" href="' + s.url + '" aria-label="' + s.go + '">' +
              iconSvg(s.key) + '<span>' + s.label + '</span></a>';
    });

    html += '<p class="jjam-switch-note" role="status" hidden></p>';
    host.innerHTML = html;

    host.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.jjam-switch-btn') : null;
      if (!a || navigator.onLine !== false) return;
      // 오프라인이면 넘어가 봐야 빈 화면이다. 지금 쓰던 화면을 지키고 이유를 알린다.
      e.preventDefault();
      showNote(host, '인터넷에 연결되면 갈 수 있어요.');
    });
  }

  var noteTimer = null;
  function showNote(host, text) {
    var note = host.querySelector('.jjam-switch-note');
    if (!note) return;
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { note.hidden = true; }, 3000);
  }

  function syncOnline() {
    var off = navigator.onLine === false;
    [].forEach.call(document.querySelectorAll('.jjam-switch'), function (host) {
      host.classList.toggle('is-offline', off);
      if (!off) {
        var note = host.querySelector('.jjam-switch-note');
        if (note) note.hidden = true;
      }
    });
  }

  function init() {
    var hosts = document.querySelectorAll('.jjam-switch[data-site]');
    if (!hosts.length) return;
    injectStyle();
    [].forEach.call(hosts, render);
    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
