class OlavurHiddenManagedValue extends HTMLElement {
  #value;

  constructor() {
    super();
    this.hidden = true;
    this.setAttribute("aria-hidden", "true");
  }

  get value() {
    return this.#value;
  }

  set value(next) {
    this.#value = next;
  }
}

if (!customElements.get("olavur-hidden-managed-value")) {
  customElements.define("olavur-hidden-managed-value", OlavurHiddenManagedValue);
}
