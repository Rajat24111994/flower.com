export const MAX_PHOTOS = 3;
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
export function validateFiles(files) {
  if (files.length > MAX_PHOTOS) throw new Error("Chọn tối đa 3 ảnh.");
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
    if (!file.size || file.size > MAX_UPLOAD_SIZE) throw new Error("Mỗi ảnh phải có dữ liệu và không quá 5 MB.");
  }
}
export async function preparePhotos(files) {
  validateFiles(files);
  const result = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const draw = () => {
        const context = canvas.getContext("2d");
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      };
      draw();
      let quality = .85, data = canvas.toDataURL("image/jpeg", quality);
      while ((data.length - 23) * 3 / 4 > 120 * 1024) {
        if (quality > .4) quality -= .15;
        else { canvas.width = Math.max(1, Math.floor(canvas.width * .75)); canvas.height = Math.max(1, Math.floor(canvas.height * .75)); draw(); }
        data = canvas.toDataURL("image/jpeg", quality);
      }
      result.push(data);
    } catch { throw new Error("Không đọc được ảnh. Hãy chọn ảnh JPG, PNG hoặc WebP khác."); }
    finally { URL.revokeObjectURL(url); }
  }
  return result;
}
