/* TXT 리더 — iOS Safari 대응 TTS 리더 */
(() => {
  "use strict";

  // ---------- 상태 ----------
  let sentences = [];      // { text, paraEnd }
  let currentIndex = 0;
  let isPlaying = false;
  let fileKey = null;      // localStorage 위치 저장용 키
  let voices = [];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const elTitle = $("title");
  const elEmpty = $("empty");
  const elSentences = $("sentences");
  const elControls = $("controls");
  const elPlay = $("btnPlay");
  const elProgressText = $("progressText");
  const elProgressBar = $("progressBar");
  const elRate = $("rate");
  const elVoice = $("voice");
  const elEncoding = $("encoding");
  const elFileInput = $("fileInput");

  // ---------- 파일 열기 ----------
  $("btnOpen").addEventListener("click", () => elFileInput.click());
  $("btnOpenBig").addEventListener("click", () => elFileInput.click());

  elFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const text = decodeText(buf, elEncoding.value);
    loadText(text, file.name, `${file.name}:${file.size}`);
    elFileInput.value = ""; // 같은 파일 재선택 허용
  });

  // 인코딩 자동 감지: UTF-8 시도 → 실패하면 EUC-KR (한국어 txt 다수)
  function decodeText(buf, enc) {
    const bytes = new Uint8Array(buf);
    // BOM 검사
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);

    if (enc !== "auto") return new TextDecoder(enc).decode(buf);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder("euc-kr").decode(buf);
    }
  }

  // ---------- 텍스트 → 문장 분할 ----------
  function splitSentences(text) {
    const result = [];
    const paragraphs = text.split(/\r?\n/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        if (result.length) result[result.length - 1].paraEnd = true;
        continue;
      }
      // 문장 부호 뒤에서 분할 (마침표/물음표/느낌표 + 닫는 따옴표·괄호 포함)
      const parts = trimmed.match(/[^.!?…]+[.!?…]+[”"』」)\]]*\s*|[^.!?…]+$/g) || [trimmed];
      for (let part of parts) {
        part = part.trim();
        if (!part) continue;
        // iOS는 너무 긴 발화가 중간에 끊기는 경우가 있어 ~180자 단위로 추가 분할
        while (part.length > 180) {
          let cut = part.lastIndexOf(",", 180);
          if (cut < 60) cut = part.lastIndexOf(" ", 180);
          if (cut < 60) cut = 180;
          result.push({ text: part.slice(0, cut + 1).trim(), paraEnd: false });
          part = part.slice(cut + 1).trim();
        }
        if (part) result.push({ text: part, paraEnd: false });
      }
      if (result.length) result[result.length - 1].paraEnd = true;
    }
    return result;
  }

  function loadText(text, name, key) {
    stopSpeech();
    sentences = splitSentences(text);
    fileKey = "txtreader:" + key;
    currentIndex = Math.min(
      parseInt(localStorage.getItem(fileKey) || "0", 10) || 0,
      Math.max(sentences.length - 1, 0)
    );

    elTitle.textContent = name;
    elEmpty.hidden = true;
    elSentences.hidden = false;
    elControls.hidden = false;

    renderSentences();
    highlight(currentIndex, true);
    updateProgress();
  }

  function renderSentences() {
    elSentences.innerHTML = "";
    const frag = document.createDocumentFragment();
    sentences.forEach((s, i) => {
      const span = document.createElement("span");
      span.className = "sentence" + (s.paraEnd ? " para-end" : "");
      span.textContent = s.text;
      span.dataset.index = i;
      frag.appendChild(span);
    });
    elSentences.appendChild(frag);
  }

  // 문장 탭 → 거기서부터 재생
  elSentences.addEventListener("click", (e) => {
    const span = e.target.closest(".sentence");
    if (!span) return;
    currentIndex = parseInt(span.dataset.index, 10);
    playFrom(currentIndex);
  });

  // ---------- TTS ----------
  function loadVoices() {
    voices = speechSynthesis.getVoices();
    // 한국어 음성 우선 정렬
    voices.sort((a, b) => (b.lang.startsWith("ko") ? 1 : 0) - (a.lang.startsWith("ko") ? 1 : 0));
    elVoice.innerHTML = "";
    voices.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${v.name} (${v.lang})`;
      elVoice.appendChild(opt);
    });
    const savedVoice = localStorage.getItem("txtreader:voice");
    if (savedVoice) {
      const idx = voices.findIndex((v) => v.name === savedVoice);
      if (idx >= 0) elVoice.value = idx;
    }
  }
  loadVoices();
  // iOS/일부 브라우저는 음성 목록이 비동기로 로드됨
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);

  function speakSentence(index) {
    if (index < 0 || index >= sentences.length) {
      isPlaying = false;
      updatePlayButton();
      return;
    }
    currentIndex = index;
    highlight(index, true);
    updateProgress();
    savePosition();

    const utter = new SpeechSynthesisUtterance(sentences[index].text);
    const v = voices[parseInt(elVoice.value, 10)];
    if (v) {
      utter.voice = v;
      utter.lang = v.lang;
    } else {
      utter.lang = "ko-KR";
    }
    utter.rate = parseFloat(elRate.value);

    utter.onend = () => {
      if (isPlaying) speakSentence(currentIndex + 1);
    };
    utter.onerror = (e) => {
      // cancel()로 인한 interrupted는 무시, 그 외 에러는 다음 문장으로 진행
      if (isPlaying && e.error !== "interrupted" && e.error !== "canceled") {
        speakSentence(currentIndex + 1);
      }
    };
    speechSynthesis.speak(utter);
  }

  function playFrom(index) {
    // iOS의 pause()/resume()은 불안정 → 항상 cancel 후 해당 문장부터 다시 시작
    speechSynthesis.cancel();
    isPlaying = true;
    updatePlayButton();
    speakSentence(index);
  }

  function stopSpeech() {
    isPlaying = false;
    speechSynthesis.cancel();
    updatePlayButton();
  }

  elPlay.addEventListener("click", () => {
    if (!sentences.length) return;
    if (isPlaying) {
      stopSpeech();
      savePosition();
    } else {
      playFrom(currentIndex);
    }
  });

  $("btnPrev").addEventListener("click", () => jump(-1));
  $("btnNext").addEventListener("click", () => jump(1));

  function jump(delta) {
    if (!sentences.length) return;
    const next = Math.min(Math.max(currentIndex + delta, 0), sentences.length - 1);
    if (isPlaying) {
      playFrom(next);
    } else {
      currentIndex = next;
      highlight(next, true);
      updateProgress();
      savePosition();
    }
  }

  elProgressBar.addEventListener("input", () => {
    const idx = parseInt(elProgressBar.value, 10);
    currentIndex = idx;
    highlight(idx, true);
    elProgressText.textContent = `${idx + 1} / ${sentences.length}`;
  });
  elProgressBar.addEventListener("change", () => {
    savePosition();
    if (isPlaying) playFrom(currentIndex);
  });

  elRate.addEventListener("change", () => {
    localStorage.setItem("txtreader:rate", elRate.value);
    if (isPlaying) playFrom(currentIndex); // 변경 즉시 반영
  });
  elVoice.addEventListener("change", () => {
    const v = voices[parseInt(elVoice.value, 10)];
    if (v) localStorage.setItem("txtreader:voice", v.name);
    if (isPlaying) playFrom(currentIndex);
  });

  const savedRate = localStorage.getItem("txtreader:rate");
  if (savedRate) elRate.value = savedRate;

  // ---------- UI 갱신 ----------
  function highlight(index, scroll) {
    elSentences.querySelector(".sentence.current")?.classList.remove("current");
    const span = elSentences.querySelector(`[data-index="${index}"]`);
    if (span) {
      span.classList.add("current");
      if (scroll) span.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function updateProgress() {
    elProgressText.textContent = `${currentIndex + 1} / ${sentences.length}`;
    elProgressBar.max = Math.max(sentences.length - 1, 0);
    elProgressBar.value = currentIndex;
  }

  function updatePlayButton() {
    elPlay.textContent = isPlaying ? "⏸" : "▶️";
  }

  function savePosition() {
    if (fileKey) localStorage.setItem(fileKey, String(currentIndex));
  }

  // 화면 전환/이탈 시 위치 저장
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) savePosition();
  });

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // 테스트용 훅 (콘솔/자동화에서 텍스트 직접 로드)
  window.__txtreader = { loadText, splitSentences };
})();
