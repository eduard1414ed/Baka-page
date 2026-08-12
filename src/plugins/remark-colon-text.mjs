import { visit } from 'unist-util-visit';

/**
 * ДВОЕТОЧИЕ ПЕРЕД СЛОВОМ — ЭТО ДВОЕТОЧИЕ, А НЕ МЕТКА.
 *
 * Метки проекта пишутся так: `:anime[Фрирен]{id="…"}`, `:spoiler-inline[…]{}`.
 * Разбор markdown считает меткой ЛЮБОЕ двоеточие, за которым идёт слово, —
 * и «Re:Zero», «Erid:2VtzqwfAwHC», «бо:рёкудан», «в 20:00» превращаются
 * в метку с именем `Zero`, `2VtzqwfAwHC`, `рёкудан`, `00`. Показывать такую
 * метку нечем, поэтому слово после двоеточия ПРОПАДАЕТ со страницы, а абзац
 * рвётся пополам: хвост уезжает наружу отдельным блоком. В архиве таких мест
 * 13 в 13 постах, среди них четыре рекламные маркировки `Erid:…`.
 *
 * ПРИЗНАК ЛОЖНОЙ МЕТКИ — НЕ СПИСОК ИМЁН, А ОТСУТСТВИЕ СКОБОК. Список имён был
 * бы второй копией того, что и так знает каждый плагин, и разъехался бы
 * с первой новой меткой. Настоящая метка всегда написана с подписью
 * в квадратных скобках или с параметрами в фигурных — их ставит кнопка
 * админки. Замер по всем постам: наших меток со скобками 48, и правило
 * не трогает ни одну; ложных без скобок 13, и правило возвращает все;
 * ни одной ложной со скобками и ни одной нашей без скобок в архиве нет.
 *
 * СОСЕДНИЙ ТЕКСТ СКЛЕИВАЕТСЯ ОБРАТНО, И ЭТО НЕ КОСМЕТИКА. Разметка тайтлов
 * ищет название внутри ОДНОГО текстового куска: оставь «Re» и «:Zero»
 * порознь — и «Re:Zero», написанный в тексте словами, перестанет находиться
 * автоматической разметкой, хотя на экране выглядит целым.
 *
 * Стоит первым после remark-directive: остальные плагины должны видеть текст
 * уже целым.
 */
export default function remarkColonText() {
	return (tree, file) => {
		const source = typeof file?.value === 'string' ? file.value : '';

		visit(tree, 'textDirective', (node, index, parent) => {
			if (!parent || typeof index !== 'number') return;

			const hasLabel = (node.children?.length ?? 0) > 0;
			const hasAttributes = Object.keys(node.attributes ?? {}).length > 0;
			if (hasLabel || hasAttributes) return;

			const replacement = { type: 'text', value: literalText(node, source) };

			// Склейка с соседями по тексту (см. пояснение выше).
			let start = index;
			let end = index + 1;
			const prev = parent.children[index - 1];
			const next = parent.children[index + 1];

			if (prev?.type === 'text') {
				replacement.value = prev.value + replacement.value;
				start = index - 1;
			}
			if (next?.type === 'text') {
				replacement.value += next.value;
				end = index + 2;
			}

			const from = parent.children[start]?.position?.start;
			const to = parent.children[end - 1]?.position?.end;
			if (from && to) replacement.position = { start: from, end: to };

			parent.children.splice(start, end - start, replacement);
			return start;
		});
	};
}

/**
 * Что человек написал в этом месте. Берём срез исходника — так возвращается
 * ровно набранное, вместе с любыми знаками, которых разбор не показал.
 * Срез бывает недоступен (файл пришёл без текста или без позиций) — тогда
 * собираем из имени метки, это тот же текст для всех случаев архива.
 */
function literalText(node, source) {
	const from = node.position?.start?.offset;
	const to = node.position?.end?.offset;

	if (source && typeof from === 'number' && typeof to === 'number') {
		const slice = source.slice(from, to);
		if (slice.startsWith(':')) return slice;
	}

	return `:${node.name}`;
}
