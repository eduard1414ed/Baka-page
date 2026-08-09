/* Меню в компактной шапке. Раскрытие, а не модальное окно:
   фокус не запирается, страница под меню остаётся доступной. */
(() => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("main-nav");
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.dataset.open = String(open);
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (toggle.getAttribute("aria-expanded") !== "true") return;
    if (e.target.closest(".header")) return;
    setOpen(false);
  });

  /* При переходе на десктопную раскладку состояние сбрасывается,
     иначе меню останется "закрытым" там, где оно должно быть видно. */
  const wide = window.matchMedia("(min-width: 821px)");
  wide.addEventListener("change", () => setOpen(false));
})();


/* Спойлеры. Слово раскрывается на месте, блок — кнопкой.
   Скрытое лежит в DOM, но до раскрытия не читается глазами;
   поисковому индексу оно не нужно, поэтому блок помечен data-noindex. */
(() => {
  document.querySelectorAll(".spoiler-word").forEach((el) => {
    el.addEventListener("click", () => {
      el.setAttribute("aria-expanded", el.getAttribute("aria-expanded") !== "true");
    });
  });

  document.querySelectorAll(".spoiler").forEach((box) => {
    const btn = box.querySelector(".spoiler-toggle");
    const body = box.querySelector(".spoiler-body");
    const label = btn.querySelector(".label");
    const mark = btn.querySelector(".mark");
    /* Автор пишет только существительное: «финал», «твист 12 серии».
       Глагол системный — иначе подписи разъедутся по формулировкам,
       и кнопка перестанет читаться как один и тот же элемент. */
    const noun = box.dataset.label || "спойлер";
    const sync = (open) => {
      label.textContent = (open ? "Скрыть " : "Показать ") + noun;
      mark.textContent = open ? "×" : "+";
    };
    sync(false);
    btn.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      sync(open);
    });
  });
})();

/* Картинка не загрузилась — подставляем заглушку с персонажем,
   а не оставляем пустое место: пустота читается как поломка вёрстки. */
(() => {
  const src = document.getElementById("img-missing-src");
  if (!src) return;
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || img.dataset.fallback) return;
    img.dataset.fallback = "1";
    const box = img.parentElement;
    box.classList.add("img-missing");
    if (box.clientWidth < 200) box.classList.add("img-missing--compact");
    box.innerHTML = '<img alt="" src="' + src.src + '"><span>Изображения нет</span>';
  }, true);
})();


/* Мини-плеер. На странице выпуска он не нужен, пока виден основной плеер:
   два одинаковых набора кнопок на одном экране — это выбор без разницы.
   Появляется, когда основной уходит за верхнюю кромку. */
(() => {
  const mini = document.getElementById("miniplayer");
  if (!mini) return;

  const close = mini.querySelector(".miniplayer-close");
  close.addEventListener("click", () => {
    mini.hidden = true;
    document.body.classList.remove("has-miniplayer");
  });

  const main = document.querySelector(".episode-copy .player");
  if (!main) return;                       // на других страницах показан всегда

  const io = new IntersectionObserver(([e]) => {
    const away = !e.isIntersecting;
    mini.hidden = !away;
    document.body.classList.toggle("has-miniplayer", away);
  }, { rootMargin: "-8px 0px 0px 0px" });
  io.observe(main);
})();


/* Каталог: поиск и сортировка. Порядок по умолчанию — как добавляли,
   он же порядковый номер на марке: CAT. 001 идёт первым. */
(() => {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;

  const search = document.getElementById("catalog-search");
  const sort = document.getElementById("catalog-sort");
  const face = document.getElementById("catalog-sort-face");
  const count = document.getElementById("catalog-count");
  const empty = document.getElementById("catalog-empty");
  const cards = [...grid.children];

  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  };

  /* Ищем и по русскому названию, и по оригинальному: половина тайтлов
     известна читателю в латинице. «е» и «ё» считаем одной буквой —
     на сайте это уже сделано для упоминаний. */
  const norm = (t) => t.toLowerCase().replace(/ё/g, "е");

  const apply = () => {
    const q = norm(search.value.trim());
    let shown = 0;

    cards.forEach((c) => {
      const hit = !q || norm(c.dataset.title + " " + c.dataset.original + " " + c.dataset.studio).includes(q);
      c.hidden = !hit;
      if (hit) shown++;
    });

    const mode = sort.value;
    const key = {
      index: (c) => Number(c.dataset.index),
      year: (c) => -Number(c.dataset.year),
      mentions: (c) => -Number(c.dataset.mentions),
    }[mode];
    const sorted = [...cards].sort((a, b) =>
      mode === "title"
        ? a.dataset.title.localeCompare(b.dataset.title, "ru")
        : key(a) - key(b));
    sorted.forEach((c) => grid.appendChild(c));

    count.textContent = q
      ? `Найдено: ${shown} ${plural(shown, "тайтл", "тайтла", "тайтлов")}`
      : `Всего: ${cards.length} ${plural(cards.length, "тайтл", "тайтла", "тайтлов")}`;

    empty.hidden = shown !== 0;
    if (!shown) {
      empty.innerHTML =
        '<div class="empty-state empty-state--inline">' +
        '<div class="tech">Ничего не нашлось</div>' +
        '<p>По запросу «' + search.value.trim() + '» в каталоге пусто. ' +
        'Попробуйте оригинальное название или часть слова.</p></div>';
    }
    if (face) face.textContent = sort.options[sort.selectedIndex].text;
  };

  search.addEventListener("input", apply);
  sort.addEventListener("change", apply);
  apply();
})();


/* Кнопка в архив меняет подпись по текущему фильтру: с главной ведёт
   одна ссылка, а не пять — но ведёт туда, где читатель уже находится. */
(() => {
  const link = document.getElementById("archive-link");
  if (!link) return;
  const label = link.querySelector("span") ? link.firstChild : null;
  const names = {
    all: ["Весь архив", "archive.html"],
    podcast: ["Все подкасты в архиве", "archive.html#podcast"],
    videoessay: ["Все видеоэссе в архиве", "archive.html#videoessay"],
    article: ["Все статьи в архиве", "archive.html#article"],
    note: ["Все заметки в архиве", "archive.html#note"],
  };
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [text, href] = names[btn.dataset.filter] || names.all;
      if (label) label.textContent = text + " ";
      link.href = href;
    });
  });
})();


/* Таймкоды: нажатие перематывает плеер. Механика та же, что у таймкодов
   внутри текста, — второй реализации быть не должно. */
(() => {
  document.querySelectorAll(".timecode-row").forEach((row) => {
    row.addEventListener("click", () => {
      const t = Number(row.dataset.time);
      const audio = document.querySelector("audio");
      if (audio) { audio.currentTime = t; audio.play(); }
    });
  });
})();
