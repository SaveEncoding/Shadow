/**
 * شمارنده‌ی کوئری D1 برای تست‌ها.
 *
 * چرا: بهینه‌سازی «حس بهتر» نیست؛ باید عدد داشته باشد. این ابزار همان D1 واقعیِ
 * `cloudflare:test` را می‌پیچد و تعداد statement هایی که واقعاً اجرا می‌شوند را
 * می‌شمارد (هر `prepare` یک رفت‌وبرگشت، هر آیتم `batch` هم یکی).
 *
 * استفاده:
 *   const { db, counter } = countingDb(env.my_database);
 *   await publishDuePosts({ ...env, my_database: db }, ...);
 *   counter.total       // همه‌ی statement ها
 *   counter.summary()   // «۳× SELECT * FROM post_queue ...»
 */

/** @param {D1Database} inner */
export function countingDb(inner) {
	const counter = {
		/** تعداد statement هایی که اجرا شد */
		total: 0,
		/** تعداد رفت‌وبرگشت به D1؛ هر `batch` فقط یکی است */
		roundTrips: 0,
		log: [],
		reset() {
			this.total = 0;
			this.roundTrips = 0;
			this.log = [];
		},
		/** خلاصه‌ی خوانا برای پیام تست */
		summary() {
			const groups = new Map();
			for (const sql of this.log) {
				const key = sql.replace(/\s+/g, ' ').trim().slice(0, 90);
				groups.set(key, (groups.get(key) ?? 0) + 1);
			}
			return [...groups.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([sql, n]) => `${n}× ${sql}`)
				.join('\n');
		},
	};

	/** proxy → statement اصلی، برای اینکه batch() بتواند ورودی واقعی بگیرد */
	const originals = new WeakMap();

	const record = (sql, roundTrips = 1) => {
		counter.total++;
		counter.roundTrips += roundTrips;
		counter.log.push(String(sql));
	};

	const wrap = (stmt, sql) => {
		const proxy = {
			bind: (...args) => wrap(stmt.bind(...args), sql),
			run: () => {
				record(sql);
				return stmt.run();
			},
			first: (...args) => {
				record(sql);
				return stmt.first(...args);
			},
			all: () => {
				record(sql);
				return stmt.all();
			},
			raw: (...args) => {
				record(sql);
				return stmt.raw(...args);
			},
		};
		originals.set(proxy, { stmt, sql });
		return proxy;
	};

	return {
		counter,
		db: new Proxy(inner, {
			get(target, key) {
				if (key === 'prepare') {
					return (sql) => wrap(target.prepare(sql), sql);
				}
				if (key === 'batch') {
					return async (statements) => {
						const real = [];
						statements.forEach((statement, index) => {
							const known = originals.get(statement);
							// اولین statement رفت‌وبرگشت را می‌سازد؛ بقیه در همان batch می‌روند
							record(known?.sql ?? '(batch statement)', index === 0 ? 1 : 0);
							real.push(known?.stmt ?? statement);
						});
						return target.batch(real);
					};
				}
				if (key === 'exec') {
					return (sql) => {
						record(sql);
						return target.exec(sql);
					};
				}
				const value = target[key];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}),
	};
}
