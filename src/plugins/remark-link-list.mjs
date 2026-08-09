import { visit } from 'unist-util-visit';
import { hostOf } from '../lib/linkIcon.mjs';

// Значения атрибутов приходят экранированными из админки (см. public/admin/index.html) —
// там кавычка ломает разбор синтаксиса директивы, поэтому её заменяют на &quot;.
// Тут — обратная замена. Обе стороны должны экранировать одинаково.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

const text = (value) => ({ type: 'text', value });
const el = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });

/**
 * `::link{label="Кинопоиск" url="https://…"}` → одна строка врезки.
 *
 * Адреса нет — строки не будет вовсе (см. flushRun): рисовать подпись,
 * которая никуда не ведёт, значит тихо врать читателю.
 */
function parseLinkNode(node) {
	const attrs = node.attributes ?? {};

	return {
		label: unescapeAttr(attrs.label ?? '').trim(),
		url: String(attrs.url ?? '').trim(),
	};
}

/**
 * Строка врезки: слева площадка, справа адрес. Ровно та же разметка, что
 * у кнопок материала в src/pages/posts/[slug].astro, — и стили у них одни
 * на двоих, второй копии нет.
 *
 * ПОДПИСЬ СТАВИТСЯ ВСЕГДА, даже пустая. Строка — двухколоночная сетка,
 * и без первой ячейки адрес уехал бы в узкий левый столбец, встав не под
 * адресами соседних строк. В админке поле обязательное, пустым оно бывает
 * только у маркера, поправленного руками.
 */
function buildRow(item) {
	return el('div', { class: 'inset-row' }, [
		el('strong', { class: 'tech' }, item.label ? [text(item.label)] : []),
		el('a', { class: 'normal-link', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, [
			text(`${hostOf(item.url) ?? item.url} ↗`),
		]),
	]);
}

/**
 * Врезка целиком.
 *
 * ЛИНИИ С ОБЕИХ СТОРОН — единственное место на сайте, где так можно (§5
 * дизайн-системы). Правило «одну линию рисует следующая секция» здесь
 * не работает: после врезки текст продолжается, и без нижней линии
 * у неё нет конца. Сами линии — в общих стилях `.inset-list` (global.css): у врезки
 * со ссылками и у оглавления выпуска вид один на двоих.
 *
 * В ПОИСК ВРЕЗКА НЕ ИДЁТ. Названия площадок и голые домены в цитате выдачи
 * читаются мусором — ровно как шапка карусели («[ галерея ]01 / 06»).
 * Так же помечены кнопки материала, чтобы два одинаковых на вид блока
 * не вели себя в поиске по-разному.
 */
function linkListData(items) {
	return {
		hName: 'div',
		hProperties: { class: 'inset-list', 'data-pagefind-ignore': '' },
		hChildren: items.map(buildRow),
	};
}

/**
 * Блок ссылок, вставляемый в произвольное место текста (тз/08, раздел 9.4).
 *
 * ОДИН МАРКЕР — ОДНА ССЫЛКА, подряд идущие маркеры собираются в одну врезку.
 * Тот же приём, что у галереи: списка внутри своего компонента CMS у нас
 * быть не может — Sveltia такие списки дважды теряла и портила. А так каждая
 * ссылка редактируется как обычный блок: видна в редакторе, переставляется
 * и удаляется вместе с абзацем.
 *
 * Это НЕ поле `buttons`. `buttons` — кнопки материала целиком, у них
 * фиксированное место под текстом. Здесь — ссылки внутри повествования,
 * место произвольное. Вид у обоих один, данные разные.
 */
export default function remarkLinkList() {
	return (tree, file) => {
		const warnNoUrl = (label) => {
			console.warn(
				`[блок ссылок] ${file?.path ?? 'пост'}: у строки «${label || 'без подписи'}» нет адреса — ` +
					'строка не показана. Впишите адрес в админке или уберите маркер.',
			);
		};

		visit(tree, (node) => {
			if (!Array.isArray(node.children)) return;

			const newChildren = [];
			let run = [];

			const flushRun = () => {
				if (run.length === 0) return;

				const items = run.map((r) => r.item).filter((item) => {
					if (item.url) return true;
					warnNoUrl(item.label);
					return false;
				});

				// Все строки оказались без адресов — врезки не будет вовсе:
				// пустая рамка из двух линий посреди текста выглядит поломкой.
				if (items.length > 0) {
					run[0].node.data = linkListData(items);
					newChildren.push(run[0].node);
				}

				run = [];
			};

			for (const child of node.children) {
				const item = child.type === 'leafDirective' && child.name === 'link' ? parseLinkNode(child) : null;

				if (item) {
					run.push({ node: child, item });
					continue;
				}

				flushRun();
				newChildren.push(child);
			}

			flushRun();
			node.children = newChildren;
		});
	};
}
