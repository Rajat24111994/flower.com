const MAX_REVIEW_PHOTOS = 3;
const MAX_PHOTO_BYTES = 120 * 1024;

function jpegDimensions(bytes) {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8
        || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    let offset = 2;
    while (offset + 4 < bytes.length) {
        if (bytes[offset++] !== 0xff) return null;
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9) return null;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = bytes.readUInt16BE(offset);
        if (length < 2 || offset + length > bytes.length) return null;
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
            if (length < 8) return null;
            return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
        }
        offset += length;
    }
    return null;
}

function validateReviewPhotos(photos = []) {
    if (!Array.isArray(photos) || photos.length > MAX_REVIEW_PHOTOS) return null;
    const result = [];
    for (const value of photos) {
        if (typeof value !== "string" || value.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 30
            || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
        const encoded = value.slice(value.indexOf(",") + 1);
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length > MAX_PHOTO_BYTES || bytes.toString("base64") !== encoded) return null;
        const dimensions = jpegDimensions(bytes);
        if (!dimensions || dimensions.width < 1 || dimensions.height < 1
            || dimensions.width > 1600 || dimensions.height > 1600) return null;
        result.push(bytes);
    }
    return result;
}
module.exports = { MAX_REVIEW_PHOTOS, MAX_PHOTO_BYTES, jpegDimensions, validateReviewPhotos };
