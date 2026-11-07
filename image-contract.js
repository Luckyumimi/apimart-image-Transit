const ImageContract = Object.freeze({
  aspectRatios: ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"],
  extAspectRatios: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"],
  validateCustomDimensions(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      return "宽和高必须是正整数。";
    }
    if (w % 16 !== 0 || h % 16 !== 0) {
      return "宽和高都必须是 16 的倍数。";
    }
    if (w > 3840 || h > 3840) {
      return "宽和高都不能超过 3840 像素。";
    }
    if (w * h < 655360 || w * h > 8294400) {
      return "总像素数必须在 655,360 到 8,294,400 之间。";
    }
    if (Math.max(w / h, h / w) > 3) {
      return "宽高比例不能超过 3:1。";
    }
    return "";
  },
});

if (typeof window !== "undefined") window.ImageContract = ImageContract;
if (typeof module !== "undefined" && module.exports) module.exports = ImageContract;
