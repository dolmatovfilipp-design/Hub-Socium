import { useRef, useSyncExternalStore } from 'react'
import { getFileShelfSnapshot, ingestPickedFiles, subscribeFileShelf } from './commands/files.ts'

/**
 * Button the spec requires after «фото», «видео» or «файл».
 * Voice does not open the system file dialog; the person presses this control.
 */
export function FileShelfHost({ conversationId }: { conversationId: string }) {
  const shelf = useSyncExternalStore(subscribeFileShelf, getFileShelfSnapshot, getFileShelfSnapshot)
  const inputRef = useRef<HTMLInputElement>(null)
  if (shelf.conversationId && shelf.conversationId !== conversationId) return null
  if (!shelf.open && !shelf.picker && shelf.items.length === 0) return null

  return (
    <div className="border-t border-white/10 bg-black px-3 py-2">
      {shelf.picker ? (
        <button
          type="button"
          className="pressable w-full rounded-xl bg-white py-2.5 text-[15px] font-semibold text-black"
          onClick={() => inputRef.current?.click()}
        >
          Выбрать файлы
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple={shelf.picker?.multiple ?? true}
        accept={shelf.picker?.accept}
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length) ingestPickedFiles(files)
        }}
      />
      {shelf.items.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {shelf.items.map((item, itemIndex) => (
            <li
              key={`${item.id}-${itemIndex}`}
              className={`truncate rounded-lg px-2 py-1 text-[13px] ${
                shelf.selectedIndex === itemIndex ? 'bg-white text-black' : 'bg-white/[0.06] text-[#ddd]'
              }`}
            >
              {itemIndex + 1}. {item.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-[#8e8e93]">Сначала выберите файлы. Голос галерею не листает.</p>
      )}
    </div>
  )
}
