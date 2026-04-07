import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-modal-shell',
  standalone: false,
  templateUrl: './modal-shell.component.html',
  styleUrls: ['./modal-shell.component.scss']
})
export class ModalShellComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() size: ModalSize = 'md';
  @Input() closeOnBackdropClick = true;
  @Input() ariaLabel = 'Dialog';
  @Input() ariaLabelledBy = '';
  @Input() ariaDescribedBy = '';
  @Output() closed = new EventEmitter<void>();

  @ViewChild('frame', { static: true }) frame?: ElementRef<HTMLElement>;

  private static openCount = 0;

  ngOnInit(): void {
    this.updateScrollLock(1);
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.frame?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.updateScrollLock(-1);
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.requestClose();
  }

  requestClose(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (!this.closeOnBackdropClick) {
      return;
    }

    if (event.target === event.currentTarget) {
      this.requestClose();
    }
  }

  get sizeClass(): string {
    return `modal-shell__frame--${this.size}`;
  }

  private updateScrollLock(delta: number): void {
    const body = document.body;
    ModalShellComponent.openCount = Math.max(0, ModalShellComponent.openCount + delta);

    if (ModalShellComponent.openCount > 0) {
      body.classList.add('ts-modal-open');
      return;
    }

    body.classList.remove('ts-modal-open');
  }
}
