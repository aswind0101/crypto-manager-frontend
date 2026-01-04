export class RingBuffer<T> {
  private buf: T[];
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    this.buf = new Array(capacity);
  }

  push(item: T) {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  toArrayNewestFirst(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      out.push(this.buf[idx]);
    }
    return out;
  }

  toArrayOldestFirst(): T[] {
    return this.toArrayNewestFirst().reverse();
  }

  get length() { return this.size; }
}
