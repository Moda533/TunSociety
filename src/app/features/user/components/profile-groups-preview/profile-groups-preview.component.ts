import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { ProfileService } from '../../data-access/profile.service';
import { GroupPreview } from '../../models/profile-media.model';

@Component({
  selector: 'app-profile-groups-preview',
  standalone: false,
  templateUrl: './profile-groups-preview.component.html',
  styleUrls: ['./profile-groups-preview.component.scss']
})
export class ProfileGroupsPreviewComponent implements OnChanges {
  @Input() userId = '';

  groups: GroupPreview[] = [];
  isLoading = false;
  errorMessage = '';

  constructor(private readonly profileService: ProfileService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId'] && this.userId) {
      this.loadGroups();
    }
  }

  trackByGroupId(_: number, group: GroupPreview): string {
    return group.id;
  }

  private loadGroups(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.profileService.getGroups(this.userId).subscribe({
      next: (groups) => {
        this.groups = groups;
        this.isLoading = false;
      },
      error: () => {
        this.groups = [];
        this.isLoading = false;
        this.errorMessage = 'Unable to load groups.';
      }
    });
  }
}
