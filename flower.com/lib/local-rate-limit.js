function createLocalRateLimit({ now = Date.now, capacity = 5000 } = {}) {
    const entries = new Map();
    return (key, maximum, duration) => {
        const time = now();
        for (const [id, entry] of entries) if (entry.until <= time) entries.delete(id);
        let entry = entries.get(key);
        if (!entry) {
            if (entries.size >= capacity) return 60;
            entry = { attempts: 0, until: time + duration }; entries.set(key, entry);
        }
        if (entry.attempts >= maximum) return Math.max(1, Math.ceil((entry.until - time) / 1000));
        entry.attempts++;
        return 0;
    };
}
module.exports = { createLocalRateLimit };
