/** The course being ridden, its run timer and missed-gate count on a timed run, top center. */
export class RaceHud {
  private readonly el: HTMLElement;
  private readonly course: HTMLElement;
  private readonly time: HTMLElement;
  private readonly missed: HTMLElement;
  private shownCourse = '';
  private shownTime = '';
  private shownMissed = -1;

  constructor(hud: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'race-hud';
    this.el.hidden = true;
    this.course = document.createElement('div');
    this.course.className = 'race-course';
    this.time = document.createElement('div');
    this.time.className = 'race-time';
    this.missed = document.createElement('div');
    this.missed.className = 'race-missed';
    this.el.append(this.course, this.time, this.missed);
    hud.appendChild(this.el);
  }

  update(visible: boolean, course: string, seconds: number, missed: number): void {
    if (this.el.hidden === visible) this.el.hidden = !visible;
    if (!visible) return;
    if (course !== this.shownCourse) {
      this.shownCourse = course;
      this.course.textContent = course;
    }
    const text = formatTime(seconds);
    if (text !== this.shownTime) {
      this.shownTime = text;
      this.time.textContent = text;
    }
    if (missed !== this.shownMissed) {
      this.shownMissed = missed;
      this.missed.textContent = missedText(missed);
    }
  }
}

/** 83.456 → "1:23.45". */
export function formatTime(seconds: number): string {
  const hundredths = Math.floor(seconds * 100);
  const m = Math.floor(hundredths / 6000);
  const s = Math.floor((hundredths % 6000) / 100);
  const h = hundredths % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}`;
}

export function missedText(missed: number): string {
  return missed === 0 ? 'No missed gates' : missed === 1 ? '1 missed gate' : `${missed} missed gates`;
}
