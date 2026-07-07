import { ref, type Ref } from 'vue'

export function useDragSort<T>(items: Ref<T[]>, emit: (items: T[]) => void) {
  const dragIdx = ref<number | null>(null)

  function onDragStart(_e: DragEvent, i: number) { dragIdx.value = i }
  function onDragOver(e: DragEvent) { e.preventDefault() }
  function onDrop(_e: DragEvent, toIdx: number) {
    if (dragIdx.value === null || dragIdx.value === toIdx) return
    const copy = [...items.value]
    const [moved] = copy.splice(dragIdx.value, 1)
    copy.splice(toIdx, 0, moved)
    emit(copy)
    dragIdx.value = null
  }
  function onDragEnd() { dragIdx.value = null }

  return { dragIdx, onDragStart, onDragOver, onDrop, onDragEnd }
}
