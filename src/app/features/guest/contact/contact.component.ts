import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-contact',
  standalone: false,
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss']
})
export class ContactComponent {
  private readonly fb = inject(FormBuilder);

  isSubmitting = false;
  successMessage = '';
  errorMessage = '';

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    subject: [''],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]]
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    // No backend endpoint for contact yet. Simulate submit success.
    setTimeout(() => {
      this.isSubmitting = false;
      this.successMessage = 'Message sent. We will reply soon.';
      this.form.reset();
    }, 400);
  }
}
