// Статьи с DTF: скачивание, кэш и общий разбор HTML в markdown.
//
// ЗАЧЕМ ЭТО В РЕПОЗИТОРИИ. Пять постов сайта собраны отсюда скриптами
// (задача 17, статус/задача-17-перенос-с-dtf.md). Пока они лежали в папке
// сессии, любая правка перенесённого текста означала «собрать руками» —
// а правки уже случались трижды: заказчик попросил переставить картинки
// и подписать студии, а сохранение из админки откатило работу и её пришлось
// восстанавливать. Скрипт, которым это делается, обязан пережить сессию.
//
// ИСХОДНИКИ НЕ ХРАНИМ, А КАЧАЕМ. Ответы api.dtf.ru — чужие данные и весят
// мегабайты; в репозиторий им нельзя (CLAUDE.md, про оригиналы с хозяином).
// Кэш лежит в .tmp-dtf/ и в git не попадает.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Путь к корню достаём через fileURLToPath, а не через .pathname: русские
// буквы в пути к проекту тот кодирует, и «файла нет» приходит про файл,
// который есть (CLAUDE.md).
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = path.join(ROOT, '.tmp-dtf');

/** Адреса статей, из которых собраны посты сайта. Ключ — наш slug. */
export const ARTICLES = {
	'obzor-vseh-anime-zimy-2022': [1149385, 1150944, 1153300, 1157405, 1167923],
	'obzor-vseh-anime-leta-2022': [1329025],
	'kakoe-anime-stoit-smotret-etoy-zimoy-2023': [1546149],
	'kakoe-anime-stoit-smotret-etoy-vesnoy-2023': [1696863],
	'kakoe-anime-stoit-smotret-etim-letom-2023': [1922981],
	'realnye-kartiny-v-mange-goluboy-period': [1247167],
};

/**
 * Ответ api.dtf.ru по номеру статьи. Скачивается один раз и кладётся в кэш.
 *
 * ПОВТОРЯЕМ ТОЛЬКО СЕТЕВОЕ. «Такой статьи нет» повтором не лечится: три
 * захода с растущими паузами превращают честный отказ в минуту молчания
 * (CLAUDE.md). Признак сетевого сбоя — `cause` у ошибки либо знакомое слово.
 */
export async function fetchArticle(id) {
	fs.mkdirSync(CACHE, { recursive: true });
	const file = path.join(CACHE, `dtf-${id}.json`);
	if (fs.existsSync(file) && fs.statSync(file).size > 100) {
		return JSON.parse(fs.readFileSync(file, 'utf8')).result;
	}

	let last;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const response = await fetch(`https://api.dtf.ru/v2.1/content?id=${id}`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const text = await response.text();
			const parsed = JSON.parse(text);
			if (!parsed.result) throw new Error(`в ответе нет статьи ${id}`);
			fs.writeFileSync(file, text);
			return parsed.result;
		} catch (error) {
			const network = error.cause || /fetch failed|timeout|network|ECONN|socket/i.test(error.message);
			last = error;
			if (!network) break;
			await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
		}
	}
	// Молчать тут нельзя: пустой ответ «статьи нет» неотличим от «интернет кончился».
	throw last ?? new Error(`api.dtf.ru не ответил про статью ${id} за четыре попытки`);
}

export const stripTags = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Переадресация → прямой адрес. Слоёв бывает ДВА, и снимать надо оба.
 *
 * Первый ставит сам DTF (`api.dtf.ru/v2.8/redirect?to=…`). Второй приезжает
 * из Google Docs: автор пишет текст там, и ссылка, скопированная из документа,
 * оказывается обёрнута в `google.com/url?q=…` вместе со счётчиком нажатий
 * (`usg`, `ust`). Сними только первый — и в посте останется ссылка, ведущая
 * на google.com: она работает, поэтому промах ничем себя не выдаёт.
 * В интервью 1805563 такая ровно одна — на первоисточник интервью, то есть
 * на самое важное место текста. В остальных пяти перенесённых статьях
 * `google.com/url` не встречается ни разу (проверено по кэшу ответов),
 * так что правило ничего им не меняет.
 */
export function unwrapRedirect(href) {
	let address = href;
	if (address.startsWith('https://api.dtf.ru/')) {
		const to = new URL(address).searchParams.get('to');
		if (to) address = decodeURIComponent(to);
	}
	if (/^https:\/\/(www\.)?google\.[a-z.]+\/url\?/.test(address)) {
		const target = new URL(address).searchParams.get('q') || new URL(address).searchParams.get('url');
		if (target) address = target;
	}
	return address;
}

/**
 * Строчный HTML блока DTF → markdown.
 *
 * ПРОБЕЛ С КРАЮ РАЗМЕТКИ ВЫНОСИТСЯ НАРУЖУ, А НЕ СЪЕДАЕТСЯ. Готовый
 * htmlToMarkdown из src/lib для этого не годится: он делает inner.trim(),
 * и «<b>Вывод: </b>» превратилось бы в «**Вывод: **» — такая пара звёздочек
 * не закрывается вовсе и осталась бы на странице звёздочками (CLAUDE.md).
 *
 * @param {(href: string) => string} [rewriteHref] чем заменить адрес ссылки
 */
export function inlineToMarkdown(html, rewriteHref = unwrapRedirect) {
	let text = html;

	text = text.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_match, href, inner) => {
		const label = inner.replace(/<[^>]+>/g, '');
		const lead = label.match(/^\s*/)[0];
		const tail = label.match(/\s*$/)[0];
		const core = label.trim();
		const destination = rewriteHref(href);
		return core ? `${lead}[${core}](${destination})${tail}` : destination;
	});

	for (const [tag, mark] of [['b', '**'], ['strong', '**'], ['i', '*'], ['em', '*']]) {
		text = text.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'), (_match, inner) => {
			const lead = inner.match(/^\s*/)[0];
			const tail = inner.match(/\s*$/)[0];
			const core = inner.trim();
			return core ? `${lead}${mark}${core}${mark}${tail}` : lead + tail;
		});
	}

	return text.replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();
}

/**
 * Текстовый блок DTF → массив абзацев.
 *
 * `<br>` СТАНОВИТСЯ ГРАНИЦЕЙ АБЗАЦА, и это не украшение: markdown без `breaks`
 * склеил бы строки через пробел, и «Оценка: 7 (перспективненько) Смотреть
 * дальше: да» вышло бы одной строкой. ВНУТРИ СПИСКА так делать нельзя —
 * см. splitIncut.
 */
export const blockToParagraphs = (html, rewriteHref) =>
	html.split(/<\/p>|<br\s*\/?>/i).map((chunk) => inlineToMarkdown(chunk, rewriteHref)).filter(Boolean);

/**
 * Врезка DTF → массив абзацев, где `<br>` ВНУТРИ пункта остаётся переносом.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ blockToParagraphs. У зимней подборки 2023 пункт списка
 * «1. Четвертый сезон „Прозы бродячих псов“» и строка «Премьера: 4 января»
 * разделены именно `<br>`, и разбиение по абзацам разорвало список на ТРИ
 * СПИСКА ПО ОДНОМУ ПУНКТУ. Поймано разбором `<ol>` в собранной странице:
 * в markdown это выглядело безобидно. Перенос внутри пункта пишется обратным
 * слэшем — два пробела в конце строки теряются молча при чистке файла.
 */
export const splitIncut = (html, rewriteHref) =>
	html
		.split(/<\/p>/i)
		.map((chunk) => chunk.split(/<br\s*\/?>/i).map((part) => inlineToMarkdown(part, rewriteHref)).filter(Boolean).join('\\\n'))
		.filter(Boolean);

/** Шапка поста. Поля и их порядок — те же, что пишет админка. */
export function frontmatter({ title, date, cover, draft = true, category = 'article', extra = [] }) {
	return [
		'---',
		`title: ${title}`,
		`date: ${date}`,
		`category: ${category}`,
		`draft: ${draft}`,
		"description: ''",
		`cover: ${cover}`,
		'noCover: false',
		"externalUrl: ''",
		"externalSource: ''",
		"adLabel: ''",
		'animeSuggested: []',
		"mentionsHidden: ''",
		"speakers: ''",
		"corrections: ''",
		"script: ''",
		"timecodes: ''",
		'bonusLinks: null',
		'pullMedia: false',
		...extra,
		'---',
		'',
	].join('\n');
}

export const postPath = (slug) => path.join(ROOT, 'src', 'content', 'posts', `${slug}.md`);
export const uploadsPath = (name) => path.join(ROOT, 'public', 'images', 'uploads', name);
