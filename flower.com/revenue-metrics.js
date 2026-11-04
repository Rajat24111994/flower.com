function getDateRangeTimestamps(startDate, endDate) {
    if (!startDate && !endDate) return null;
    if (!startDate || !endDate) return [];

    const startParts = startDate.split("-").map(Number);
    const endParts = endDate.split("-").map(Number);
    if (startParts.length !== 3 || endParts.length !== 3) return [];

    const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
        || startDate !== `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`
        || endDate !== `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
        || start > end) {
        return [];
    }

    end.setDate(end.getDate() + 1);
    return [start.getTime(), end.getTime()];
}

export function getRevenueMetrics(orders, dateRange = {}, normalizeStatus = (status) => status) {
    const timestamps = getDateRangeTimestamps(dateRange.startDate, dateRange.endDate);
    if (timestamps && !timestamps.length) {
        return { orders: [], totalRevenue: 0, totalSoldUnits: 0, averagePerOrder: 0 };
    }

    const eligibleOrders = (Array.isArray(orders) ? orders : []).filter((order) => {
        if (!order || typeof order !== "object") return false;
        if (normalizeStatus(order.status) !== "Đã giao") return false;
        if (!timestamps) return true;

        let deliveryTimestamp;
        if (Array.isArray(order.trackingHistory)) {
            for (let index = order.trackingHistory.length - 1; index >= 0; index -= 1) {
                const event = order.trackingHistory[index];
                if (!event || normalizeStatus(event.status) !== "Đã giao") continue;
                const timestamp = new Date(event.updatedAt).getTime();
                if (Number.isFinite(timestamp)) {
                    deliveryTimestamp = timestamp;
                    break;
                }
            }
        }
        const orderTimestamp = deliveryTimestamp
            ?? new Date(order.trackingUpdatedAt || order.createdAt).getTime();
        return Number.isFinite(orderTimestamp)
            && orderTimestamp >= timestamps[0]
            && orderTimestamp < timestamps[1];
    });

    const totalRevenue = eligibleOrders.reduce((sum, order) => {
        const total = Number(order.total);
        return sum + (Number.isFinite(total) ? total : 0);
    }, 0);
    const totalSoldUnits = eligibleOrders.reduce((sum, order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        return sum + items.reduce((itemSum, item) => {
            const quantity = Number(item && item.quantity);
            return itemSum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
        }, 0);
    }, 0);

    return {
        orders: eligibleOrders,
        totalRevenue,
        totalSoldUnits,
        averagePerOrder: eligibleOrders.length ? totalRevenue / eligibleOrders.length : 0
    };
}

export function createRandomDemoRevenueOrders(targetRevenue, currentRevenue, year, random = Math.random) {
    if (!Number.isSafeInteger(targetRevenue) || targetRevenue < 0
        || !Number.isSafeInteger(currentRevenue) || currentRevenue < 0
        || !Number.isInteger(year) || year < 1000 || year > 9999) {
        throw new TypeError("Invalid revenue target, current revenue, or year.");
    }

    const remainingRevenue = targetRevenue - currentRevenue;
    if (remainingRevenue < 0) {
        throw new RangeError("Actual revenue already exceeds the demo target.");
    }
    if (remainingRevenue === 0) return [];

    const orderCount = Math.min(10, remainingRevenue);
    const amounts = [];
    let remaining = remainingRevenue;
    for (let index = 0; index < orderCount - 1; index += 1) {
        const available = remaining - (orderCount - index - 1);
        const sample = random();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
            throw new RangeError("Random source must return a value from 0 inclusive to 1 exclusive.");
        }
        const amount = 1 + Math.floor(sample * available);
        amounts.push(amount);
        remaining -= amount;
    }
    amounts.push(remaining);

    const daysInNovember = new Date(year, 11, 0).getDate();
    return amounts.map((total, index) => {
        const sample = random();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
            throw new RangeError("Random source must return a value from 0 inclusive to 1 exclusive.");
        }
        const day = 1 + Math.floor(sample * daysInNovember);
        const deliveredAt = new Date(year, 10, day, 12).toISOString();

        return {
            id: `demo-revenue-${year}-11-${Date.now()}-${index}`,
            status: "Đã giao",
            createdAt: deliveredAt,
            trackingUpdatedAt: deliveredAt,
            trackingHistory: [{ status: "Đã giao", updatedAt: deliveredAt }],
            total,
            items: [],
            isDemoRevenue: true
        };
    });
}
