#!/usr/bin/env node
// Кадры к сборнику «Обзор всех аниме осени 2022»: сжатие и раскладка по именам.
//
//   node scripts/osen-2022/images.mjs --from=<папка>
//
// ОРИГИНАЛЫ В РЕПОЗИТОРИЙ НЕ КЛАДЁМ — правило проекта. Заказчик принёс
// одиннадцать файлов со случайными именами; здесь записано, какой кадр
// какому тайтлу достался, и это ЕДИНСТВЕННОЕ место, где такая связь живёт.
// Опознан каждый кадр глазами, а не выведен из имени файла: имена вида
// `bb5a8413…jpg` не говорят ни о чём, а подпись не от того тайтла хуже
// пропавшей — она выглядит правильной, и заметить её будет некому.
//
// Сжатие — ТЕМ ЖЕ ПРАВИЛОМ, КОТОРЫМ СЖИМАЕТ АДМИНКА при вставке
// (`media_libraries.default.config.transformations`): webp, качество 85,
// вписать в 2048, не увеличивать. Иначе перенесённая картинка отличалась бы
// от вставленной руками.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// файл заказчика → номер кадра в сборнике. Номер = порядок выхода в канале.
export const FRAMES = [
	{ from: '1271532.jpg', to: 'osen-2022-01.webp', title: 'Сделай это сам!' },
	{ from: '1c1404a4-a3e7-4a61-b9b9-68074ac51fae.webp', to: 'osen-2022-02.webp', title: 'О моём перерождении в меч' },
	{ from: '002d935c4c9565a15a7f9d2bf240002e.webp', to: 'osen-2022-03.webp', title: 'Я стала злодейкой, поэтому мне нужно заарканить последнего босса' },
	{ from: '1293435.jpg', to: 'osen-2022-04.webp', title: 'Рок-тихоня' },
	{ from: '0740beac-5b9e-492f-8390-dc5d4663436b.jpg', to: 'osen-2022-05.webp', title: 'Синяя тюрьма' },
	{ from: '5_1667855744.jpg', to: 'osen-2022-06.webp', title: 'Больше, чем пара, меньше, чем любовники' },
	{ from: 'bb5a841340c0b08ada1c5145efd92c1489f3cd54.jpg', to: 'osen-2022-07.webp', title: 'Время ниндзя' },
	{ from: '50628t.jpg', to: 'osen-2022-08.webp', title: 'Университет сумасшедших людей' },
	{ from: '1300681.jpg', to: 'osen-2022-09.webp', title: 'Жилой комплекс С' },
	{ from: 'a9cd4c62-b0c3-42a7-8365-8c7e0fc1c8e6.webp', to: 'osen-2022-10.webp', title: 'Любовные неудачи' },
	{ from: '1_1666080162.jpg', to: 'osen-2022-11.webp', title: 'Легенда о святом мече: Легенда маны' },
];

export async function convert(from, to) {
	const bytes = fs.readFileSync(from);
	const out = await sharp(bytes)
		.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 85 })
		.toBuffer();
	fs.writeFileSync(to, out);
	const meta = await sharp(out).metadata();
	return { was: bytes.length, now: out.length, width: meta.width, height: meta.height };
}

async function main() {
	const from = process.argv.find((a) => a.startsWith('--from='))?.slice('--from='.length);
	if (!from) throw new Error('нужен ключ --from=<папка с оригиналами>');
	const uploads = path.join(ROOT, 'public', 'images', 'uploads');

	let was = 0;
	let now = 0;
	for (const frame of FRAMES) {
		const source = path.join(from, frame.from);
		if (!fs.existsSync(source)) throw new Error(`нет файла: ${source}`);
		const size = await convert(source, path.join(uploads, frame.to));
		was += size.was;
		now += size.now;
		console.log(
			`${frame.to}  ${String(size.width).padStart(4)}×${String(size.height).padEnd(4)}  `
			+ `${(size.was / 1024).toFixed(0).padStart(4)} → ${(size.now / 1024).toFixed(0).padStart(4)} КБ   ${frame.title}`,
		);
	}
	console.log(`\nвсего: ${FRAMES.length} шт., ${(was / 1024 / 1024).toFixed(2)} → ${(now / 1024 / 1024).toFixed(2)} МБ`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
