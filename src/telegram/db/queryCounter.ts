/**
 * شمارنده‌ی کوئری برای **محیط اجرا** (نه تست).
 *
 * چرا لازم است؟ Cloudflare تعداد کوئری‌های D1 هر invocation را گزارش نمی‌کند؛
 * هرچه در Workers Logs می‌بینیم CPU و مدت اجراست. برای اینکه «بهینه‌سازی» بر
 * اساس عدد باشد، کرون هر دقیقه یک خط JSON با تعداد statement ها و تعداد
 * رفت‌وبرگشت‌ها لاگ می‌کند.
 *
 * هزینه: یک Proxy برای هر تیک (هر دقیقه یک‌بار) و یک WeakMap برای بازکردن
 * statement ها در `batch`. مسیر وبهوک دست‌نخورده می‌ماند.
 */

/** خلاصه‌ی شمارش یک تیک */
export interface QueryCounter {
	/** تعداد statement هایی که اجرا شد */
	total: number;
	/** تعداد رفت‌وبرگشت به D1؛ هر `batch` فقط یکی است */
	roundTrips: number;
	/** الگوی SQL ← تعداد؛ برای پیدا کردن کوئری پرمصرف */
	patterns: Map<string, number>;
	reset(): void;
	/** خلاصه‌ی خوانا برای لاگ و پیام تست */
	summary(): string;
}

export interface CountedDb {
	db: D1Database;
	counter: QueryCounter;
}

/** حداکثر تعداد الگوی نگه‌داری‌شده؛ تیک سالم چند الگو دارد، نه صدها */
const MAX_PATTERNS = 40;

/** الگوی SQL را برای گروه‌بندی کوتاه می‌کند (فاصله‌ها و پارامترها یکی می‌شوند) */
function patternOf(sql: string): string {
	return sql.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function countQueries(inner: D1Database): CountedDb {
	const patterns = new Map<string, number>();

	const counter: QueryCounter = {
		total: 0,
		roundTrips: 0,
		patterns,
		reset() {
			this.total = 0;
			this.roundTrips = 0;
			patterns.clear();
		},
		summary() {
			return [...patterns.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([sql, n]) => `${n}× ${sql}`)
				.join('\n');
		},
	};

	const record = (sql: string, roundTrips = 1) => {
		counter.total++;
		counter.roundTrips += roundTrips;
		if (patterns.size < MAX_PATTERNS || patterns.has(patternOf(sql))) {
			const key = patternOf(sql);
			patterns.set(key, (patterns.get(key) ?? 0) + 1);
		}
	};

	/** statement اصلی برای اینکه `batch` بتواند ورودی واقعی بگیرد */
	const originals = new WeakMap<object, { stmt: D1PreparedStatement; sql: string }>();

	const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
		const proxy = {
			bind: (...args: unknown[]) => wrap(stmt.bind(...args), sql),
			run: () => {
				record(sql);
				return stmt.run();
			},
			first: (...args: unknown[]) => {
				record(sql);
				// امضای `first` چند شکلی است؛ همان آرگومان‌ها را پاس می‌دهیم.
				return (stmt.first as (...a: unknown[]) => Promise<unknown>)(...args);
			},
			all: () => {
				record(sql);
				return stmt.all();
			},
			raw: (...args: unknown[]) => {
				record(sql);
				return (stmt.raw as (...a: unknown[]) => Promise<unknown[]>)(...args);
			},
		};
		originals.set(proxy, { stmt, sql });
		return proxy as unknown as D1PreparedStatement;
	};

	const db = new Proxy(inner, {
		get(target, key) {
			if (key === 'prepare') {
				return (sql: string) => wrap(target.prepare(sql), sql);
			}
			if (key === 'batch') {
				return async (statements: D1PreparedStatement[]) => {
					const real: D1PreparedStatement[] = [];
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
				return (sql: string) => {
					record(sql);
					return target.exec(sql);
				};
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as D1Database;

	return { db, counter };
}
