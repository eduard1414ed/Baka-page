// Три состояния кнопки «Показать ещё» (§8.1 дизайн-системы) — один код
// на все ленты, где она стоит: главная, каталог, страница тайтла.
//
// Разметку рисует src/components/LoadMore.astro, подписи приезжают оттуда
// же атрибутами. Здесь только переключение: копий этой логики в трёх скриптах
// быть не должно, они разъехались бы сначала стрелкой, потом `aria-expanded`.
//
// Работает в браузере: модуль импортируют клиентские скрипты страниц.

/**
 * @param {HTMLButtonElement | null} button
 * @param {'more' | 'less' | 'done'} state
 *   more — показаны не все, less — всё показано после нажатия,
 *   done — показывать нечего изначально.
 */
export function setLoadMoreState(button, state) {
	if (!button) return;

	const label = button.querySelector('.load-more-label');
	const arrow = button.querySelector('.down');
	const text = button.dataset[state];

	if (label && text) label.textContent = text;
	if (arrow) arrow.textContent = state === 'done' ? '' : state === 'less' ? '↑' : '↓';

	// Выключенная кнопка ничего не раскрывает, и диктору об этом надо сказать
	// состоянием, а не только цветом.
	button.disabled = state === 'done';
	button.setAttribute('aria-expanded', String(state === 'less'));
}
