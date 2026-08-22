import {
    Context, db, Handler, moment, RecordModel, STATUS, SystemModel,
} from 'hydrooj';

const CACHE_COLL = 'contribution.cache';
const DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes

interface CacheDoc {
    _id: string;
    domainId: string;
    uid: number;
    days: Record<string, number>;
    total: number;
    updateAt: Date;
    stale?: boolean;
}

const coll = db.collection(CACHE_COLL as any) as unknown as import('mongodb').Collection<CacheDoc>;

function timezone(): string {
    return SystemModel.get('contribution.timezone') || 'Asia/Shanghai';
}

function ttl(): number {
    const v = SystemModel.get('contribution.cacheTtl');
    return (typeof v === 'number' && v > 0) ? v : DEFAULT_TTL;
}

function cacheKey(domainId: string, uid: number) {
    return `${domainId}/${uid}`;
}

/**
 * Aggregate the record collection into a { 'YYYY-MM-DD': count } map where each
 * count is the number of *distinct problems* whose first AC fell on that day.
 * Summing every value gives the all-time solved count.
 */
async function computeDays(domainId: string, uid: number): Promise<{ days: Record<string, number>; total: number }> {
    const rows = await RecordModel.coll.aggregate<{ _id: any; first: import('mongodb').ObjectId }>([
        { $match: { domainId, uid, status: STATUS.STATUS_ACCEPTED } },
        // Earliest ObjectId per problem == the moment it was first solved.
        { $group: { _id: '$pid', first: { $min: '$_id' } } },
    ], { allowDiskUse: true }).toArray();
    const days: Record<string, number> = {};
    const zone = timezone();
    for (const r of rows) {
        if (!r.first) continue;
        const key = moment(r.first.getTimestamp()).tz(zone).format('YYYY-MM-DD');
        days[key] = (days[key] || 0) + 1;
    }
    return { days, total: rows.length };
}

async function getDays(domainId: string, uid: number): Promise<{ days: Record<string, number>; total: number }> {
    const _id = cacheKey(domainId, uid);
    const cached = await coll.findOne({ _id });
    if (cached && !cached.stale && cached.updateAt && (Date.now() - cached.updateAt.getTime() < ttl())) {
        return { days: cached.days || {}, total: cached.total || 0 };
    }
    const res = await computeDays(domainId, uid);
    await coll.updateOne(
        { _id },
        {
            $set: {
                domainId, uid, days: res.days, total: res.total, updateAt: new Date(), stale: false,
            },
        },
        { upsert: true },
    );
    return res;
}

const DAY = 'YYYY-MM-DD';
const nextDay = (d: string) => moment(d, DAY).add(1, 'day').format(DAY);

/** Longest run of consecutive calendar days in a chronologically sorted list. */
function longestRun(sortedDays: string[]): number {
    let max = 0;
    let run = 0;
    let prev: string | null = null;
    for (const d of sortedDays) {
        if (prev && nextDay(prev) === d) run++;
        else run = 1;
        prev = d;
        if (run > max) max = run;
    }
    return max;
}

interface Stats {
    solvedAllTime: number;
    solvedLastYear: number;
    solvedLastMonth: number;
    streakMax: number;
    streakLastYear: number;
    streakLastMonth: number;
    years: string[];
    currentYear: number;
}

function computeStats(days: Record<string, number>, total: number): Stats {
    const zone = timezone();
    const today = moment().tz(zone).startOf('day');
    const todayStr = today.format(DAY);
    const yearAgo = today.clone().subtract(1, 'year').format(DAY);
    const monthAgo = today.clone().subtract(1, 'month').format(DAY);

    let solvedLastYear = 0;
    let solvedLastMonth = 0;
    for (const [d, c] of Object.entries(days)) {
        if (d >= yearAgo && d <= todayStr) solvedLastYear += c;
        if (d >= monthAgo && d <= todayStr) solvedLastMonth += c;
    }

    const active = Object.keys(days).filter((d) => days[d] > 0).sort();
    const streakMax = longestRun(active);
    const streakLastYear = longestRun(active.filter((d) => d >= yearAgo && d <= todayStr));
    const streakLastMonth = longestRun(active.filter((d) => d >= monthAgo && d <= todayStr));

    const currentYear = today.year();
    const yearSet = new Set<string>(active.map((d) => d.slice(0, 4)));
    yearSet.add(String(currentYear));
    const years = [...yearSet].sort((a, b) => Number(b) - Number(a));

    return {
        solvedAllTime: total,
        solvedLastYear,
        solvedLastMonth,
        streakMax,
        streakLastYear,
        streakLastMonth,
        years,
        currentYear,
    };
}

export async function apply(ctx: Context) {
    // A dedicated index so the aggregation only scans this user's AC records.
    // Idempotent: ensureIndexes is a no-op if the index already exists.
    try {
        await db.ensureIndexes(
            RecordModel.coll,
            { key: { domainId: 1, uid: 1, status: 1, pid: 1 }, name: 'contribution' },
        );
    } catch (e) {
        ctx.logger('contribution').warn('Failed to ensure index: %s', e?.message || e);
    }

    // Attach contribution data to the profile page response.
    ctx.on('handler/after/UserDetail' as any, async (h: Handler) => {
        try {
            if ((h.request.method || '').toLowerCase() !== 'get') return;
            const udoc = (h.response.body as any)?.udoc;
            if (!udoc?._id) return;
            const domainId = (h.args as any).domainId || h.domain?._id;
            if (!domainId) return;
            const { days, total } = await getDays(domainId, udoc._id);
            const stats = computeStats(days, total);
            (h.response.body as any).contribution = {
                days,
                stats,
                tz: timezone(),
            };
        } catch (e) {
            // Never let the graph break the profile page.
            ctx.logger('contribution').warn('Failed to build contribution data: %s', e?.stack || e);
        }
    });

    // Invalidate the cache when a user newly solves something so the next view
    // is fresh without waiting out the TTL. Marking stale is O(1).
    ctx.on('record/judge' as any, async (rdoc: any, updated: boolean) => {
        try {
            if (rdoc.status !== STATUS.STATUS_ACCEPTED || !updated) return;
            await coll.updateOne({ _id: cacheKey(rdoc.domainId, rdoc.uid) }, { $set: { stale: true } });
        } catch (e) {
            ctx.logger('contribution').warn('Failed to invalidate cache: %s', e?.message || e);
        }
    });

    ctx.i18n.load('zh', {
        'Contributions': '贡献',
        'cg_unit_problem': '道题',
        'cg_unit_problems': '道题',
        'cg_unit_day': '天',
        'cg_unit_days': '天',
        'solved for all time': '历史累计',
        'solved for the last year': '最近一年',
        'solved for the last month': '最近一月',
        'in a row max.': '最长连续',
        'in a row for the last year': '最近一年连续',
        'in a row for the last month': '最近一月连续',
        '{0} problems solved in {1}': '{1} 年共解出 {0} 道题',
        'No activity in {0}': '{0} 年暂无记录',
        '{0} problems on {1}': '{1}：解出 {0} 道题',
        'No problems on {0}': '{0}：无记录',
        'Less': '少',
        'More': '多',
        'Mon': '一',
        'Wed': '三',
        'Fri': '五',
    });
    ctx.i18n.load('en', {
        'Contributions': 'Contributions',
        'cg_unit_problem': 'problem',
        'cg_unit_problems': 'problems',
        'cg_unit_day': 'day',
        'cg_unit_days': 'days',
        'solved for all time': 'solved for all time',
        'solved for the last year': 'solved for the last year',
        'solved for the last month': 'solved for the last month',
        'in a row max.': 'in a row max.',
        'in a row for the last year': 'in a row for the last year',
        'in a row for the last month': 'in a row for the last month',
    });
}
