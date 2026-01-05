type Handler<T> = (evt: T) => void;

export class EventBus<T> {
  private handlers = new Set<Handler<T>>();

  on(h: Handler<T>) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  emit(evt: T) {
    this.handlers.forEach((h) => h(evt));
  }
}
