// GLTFExporter 在二进制路径用到浏览器 FileReader，这里给 Node 补一个最小实现
// 仅支持 readAsArrayBuffer / readAsDataURL + onloadend，满足导出 GLB 的需要
if (typeof globalThis.FileReader === 'undefined') {
  class FileReader {
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer()).then((ab) => {
        this.result = ab;
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
    readAsDataURL(blob) {
      Promise.resolve(blob.arrayBuffer()).then((ab) => {
        const b64 = Buffer.from(ab).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  }
  globalThis.FileReader = FileReader;
}
