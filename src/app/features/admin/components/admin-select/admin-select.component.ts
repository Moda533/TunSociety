import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostListener,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChild,
  ViewChildren
} from '@angular/core';
import { ConnectedOverlayPositionChange, ConnectedPosition } from '@angular/cdk/overlay';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subscription } from 'rxjs';

export interface AdminSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-admin-select',
  standalone: false,
  templateUrl: './admin-select.component.html',
  styleUrls: ['./admin-select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AdminSelectComponent),
      multi: true
    }
  ]
})
export class AdminSelectComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
  readonly overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 }
  ];

  @Input()
  set value(value: string | null) {
    this.writeValue(value);
  }

  @Input()
  set disabled(value: boolean | string | null | undefined) {
    this.setDisabledState(value !== null && value !== undefined && `${value}` !== 'false');
  }

  @Input() options: readonly AdminSelectOption[] = [];
  @Input() placeholder = 'Select option';
  @Input() ariaLabel = 'Select option';
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('triggerButton') private triggerButton?: ElementRef<HTMLButtonElement>;
  @ViewChildren('optionButton') private optionButtons?: QueryList<ElementRef<HTMLButtonElement>>;

  currentValue = '';
  isOpen = false;
  isDisabled = false;
  isOpenAbove = false;
  overlayWidth = 0;

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private optionButtonsSubscription = Subscription.EMPTY;
  private focusModeOnOpen: 'selected' | 'last' = 'selected';

  constructor() {}

  ngAfterViewInit(): void {
    this.optionButtonsSubscription.unsubscribe();
    this.optionButtonsSubscription = this.optionButtons?.changes.subscribe(() => {
      if (this.isOpen) {
        this.focusSelectedOption();
      }
    }) ?? Subscription.EMPTY;
  }

  ngOnDestroy(): void {
    this.optionButtonsSubscription.unsubscribe();
  }

  get selectedOption(): AdminSelectOption | null {
    return this.options.find((option) => option.value === this.currentValue) ?? null;
  }

  writeValue(value: string | null): void {
    this.currentValue = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
    if (isDisabled) {
      this.closeMenu(false);
    }
  }

  toggleMenu(): void {
    if (this.isDisabled) {
      return;
    }

    if (this.isOpen) {
      this.closeMenu();
      return;
    }

    this.focusModeOnOpen = 'selected';
    this.syncOverlayWidth();
    this.isOpen = true;
  }

  selectOption(option: AdminSelectOption): void {
    if (option.disabled || option.value === this.currentValue) {
      this.closeMenu();
      return;
    }

    this.currentValue = option.value;
    this.onChange(option.value);
    this.valueChange.emit(option.value);
    this.closeMenu();
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.isOpen) {
          this.focusModeOnOpen = event.key === 'ArrowUp' ? 'last' : 'selected';
          this.syncOverlayWidth();
          this.isOpen = true;
        }
        break;
      case 'Escape':
        if (this.isOpen) {
          event.preventDefault();
          this.closeMenu();
        }
        break;
      default:
        break;
    }
  }

  onOptionKeydown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusOption(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusOption(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusOption(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusOption(this.options.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        this.closeMenu();
        break;
      case 'Tab':
        this.closeMenu(false);
        break;
      default:
        break;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.isOpen) {
      this.syncOverlayWidth();
    }
  }

  onOverlayAttach(): void {
    this.syncOverlayWidth();
    queueMicrotask(() => this.focusSelectedOption(this.focusModeOnOpen));
  }

  onOverlayDetach(): void {
    this.isOpen = false;
  }

  onPositionChange(event: ConnectedOverlayPositionChange): void {
    this.isOpenAbove = event.connectionPair.overlayY === 'bottom';
  }

  closeMenu(restoreFocus = true): void {
    this.isOpen = false;
    this.onTouched();

    if (restoreFocus) {
      queueMicrotask(() => this.triggerButton?.nativeElement.focus());
    }
  }

  private focusSelectedOption(mode: 'selected' | 'last' = 'selected'): void {
    if (!this.optionButtons?.length) {
      return;
    }

    if (mode === 'last') {
      this.focusOption(this.options.length - 1);
      return;
    }

    const selectedIndex = this.options.findIndex((option) => option.value === this.currentValue && !option.disabled);
    this.focusOption(selectedIndex >= 0 ? selectedIndex : 0);
  }

  private focusOption(index: number): void {
    const buttons = this.optionButtons?.toArray() ?? [];
    if (!buttons.length) {
      return;
    }

    const safeIndex = Math.min(Math.max(index, 0), buttons.length - 1);
    buttons[safeIndex]?.nativeElement.focus();
  }

  private syncOverlayWidth(): void {
    this.overlayWidth = this.triggerButton?.nativeElement.getBoundingClientRect().width ?? 0;
  }
}
