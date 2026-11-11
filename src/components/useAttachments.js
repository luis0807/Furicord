import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { uploadImage } from "../lib/api.js";
import { ALLOWED_IMAGE_TYPES, MAX_ATTACHMENTS, MAX_UPLOAD_BYTES } from "../lib/config.js";
import { randomId } from "../lib/identity.js";

// Cada imagem é enviada assim que é anexada (colar, arrastar ou escolher), para a
// mensagem sair na hora quando a pessoa apertar Enter.
export function useAttachments() {
  const [items, setItems] = useState([]); // { key, name, previewUrl, status, uploadId }
  const [notice, setNotice] = useState(null);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  });

  // Libera as prévias da memória quando o canal é fechado.
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);

  const update = (key, patch) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const remove = useCallback((key) => {
    const item = itemsRef.current.find((entry) => entry.key === key);
    if (item) URL.revokeObjectURL(item.previewUrl);
    setItems((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const add = useCallback(
    (fileList) => {
      let count = itemsRef.current.length;
      const problems = [];

      for (const file of fileList) {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
          problems.push(`"${file.name}" não é uma imagem PNG, JPEG, GIF ou WebP.`);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          problems.push(`"${file.name}" passa de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
          continue;
        }
        if (count >= MAX_ATTACHMENTS) {
          problems.push(`No máximo ${MAX_ATTACHMENTS} imagens por mensagem.`);
          break;
        }
        count += 1;

        const key = randomId();
        const name = file.name || "imagem.png";
        setItems((current) => [
          ...current,
          { key, name, previewUrl: URL.createObjectURL(file), status: "uploading", uploadId: null },
        ]);

        readImageSize(file)
          .then((size) => uploadImage(file, size))
          .then((upload) => update(key, { status: "done", uploadId: upload.id }))
          .catch((err) => {
            setNotice(`Não foi possível enviar "${name}": ${err.message}`);
            remove(key);
          });
      }

      setNotice(problems.length ? problems.join(" ") : null);
    },
    [remove],
  );

  const clear = useCallback(() => {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setItems([]);
  }, []);

  return {
    items,
    notice,
    dismissNotice: () => setNotice(null),
    add,
    remove,
    clear,
    uploading: items.some((item) => item.status === "uploading"),
    readyIds: items.filter((item) => item.status === "done").map((item) => item.uploadId),
  };
}

// Mandamos largura/altura junto para a mensagem reservar o espaço certo antes de a
// imagem carregar (senão a lista "pula" quando ela aparece).
async function readImageSize(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}
