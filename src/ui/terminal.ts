/**
 * Le terminal divin : la bouche du compilateur d'intentions (intents.ts).
 * Le joueur écrit ce qu'il veut ; le terminal montre le PATCH COMPILÉ et son
 * coût ; le joueur confirme (« oui » ou Entrée à vide) ; la simulation décide.
 * Aucune logique de jeu ici — uniquement de l'affichage et la confirmation.
 */
import {
  applyPatch,
  compileIntent,
  INTENT_HELP,
  type CompiledPatch,
  type IntentContext,
} from '../simulation/intents.js';

export class Terminal {
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private pending: CompiledPatch | null = null;
  private readonly history: string[] = [];
  private historyIndex = -1;

  constructor(
    root: HTMLElement,
    private readonly ctx: IntentContext,
  ) {
    this.log = document.createElement('div');
    this.log.className = 'term-log';
    const form = document.createElement('form');
    form.className = 'term-form';
    const prompt = document.createElement('span');
    prompt.className = 'term-prompt';
    prompt.textContent = '𝚿';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'écrivez ce qui doit arriver — « aide » pour le vocabulaire';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    form.append(prompt, this.input);
    root.append(this.log, form);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(this.input.value);
      this.input.value = '';
    });
    // Historique au clavier, comme un vrai terminal.
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.historyIndex < this.history.length - 1) this.historyIndex++;
        this.input.value = this.history[this.history.length - 1 - this.historyIndex] ?? '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.historyIndex > -1) this.historyIndex--;
        this.input.value =
          this.historyIndex === -1 ? '' : (this.history[this.history.length - 1 - this.historyIndex] ?? '');
      }
    });

    this.say('sys', 'Terminal divin prêt. Ce que vous écrivez est compilé en actes — l\'univers décide du reste.');
  }

  private say(kind: 'user' | 'sys' | 'patch' | 'result' | 'error', text: string): void {
    for (const line of text.split('\n')) {
      const el = document.createElement('div');
      el.className = `term-line ${kind}`;
      el.textContent = kind === 'user' ? `𝚿 ${line}` : line;
      this.log.appendChild(el);
    }
    while (this.log.children.length > 60) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  private submit(raw: string): void {
    const text = raw.trim();

    // Un patch attend confirmation : « oui »/Entrée applique, le reste annule.
    if (this.pending) {
      const patch = this.pending;
      this.pending = null;
      if (text === '' || /^(oui|ok|applique|go|yes)$/i.test(text)) {
        for (const result of applyPatch(patch, this.ctx)) this.say('result', `→ ${result}`);
        return;
      }
      this.say('sys', 'Patch abandonné.');
      if (text === '') return;
      // La nouvelle phrase est traitée normalement ci-dessous.
    }

    if (text === '') return;
    this.history.push(text);
    this.historyIndex = -1;
    this.say('user', text);

    if (/^(aide|help|\?)$/i.test(text)) {
      this.say('sys', INTENT_HELP);
      return;
    }

    const compiled = compileIntent(text, this.ctx);
    if ('failure' in compiled) {
      this.say('error', `Le compilateur ne comprend pas « ${compiled.failure.fragment} ». Tapez « aide ».`);
      return;
    }
    const { patch } = compiled;
    // Les actions gratuites et sans ambiguïté s'appliquent directement ;
    // dès qu'il y a un coût, on montre le patch et on attend confirmation.
    if (patch.totalCost === 0) {
      for (const result of applyPatch(patch, this.ctx)) this.say('result', `→ ${result}`);
      return;
    }
    this.say('patch', `Patch compilé (${patch.totalCost} ⚙, libre : ${this.ctx.engine.free}) :`);
    for (const action of patch.actions) {
      this.say('patch', `  • ${action.description}${action.cost > 0 ? ` — ${action.cost} ⚙` : ''}`);
    }
    this.say('sys', 'Entrée (ou « oui ») pour appliquer, autre chose pour abandonner.');
    this.pending = patch;
  }
}
