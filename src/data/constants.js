export const STATUSES = {
  draft: { label: 'Draft' },
  progress: { label: 'In progress' },
  published: { label: 'Published' },
};

export const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'progress', label: 'In progress' },
  { id: 'published', label: 'Published' },
];

export const SORTS = [
  { id: 'updated', label: 'Last edited' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'progress', label: 'Progress' },
];

// Every cover color passes 3:1 contrast with its ink for large title text.
export const COVER_COLORS = [
  { id: 'violet', name: 'Violet', bg: '#6D4AFF', ink: '#FFFFFF' },
  { id: 'coral', name: 'Coral', bg: '#E5482A', ink: '#FFFFFF' },
  { id: 'teal', name: 'Teal', bg: '#0B8484', ink: '#FFFFFF' },
  { id: 'blue', name: 'Blue', bg: '#2F6FE4', ink: '#FFFFFF' },
  { id: 'amber', name: 'Amber', bg: '#FFB020', ink: '#1A1A2E' },
  { id: 'pink', name: 'Pink', bg: '#D63A7E', ink: '#FFFFFF' },
];

export function coverColor(id) {
  return COVER_COLORS.find((c) => c.id === id) || COVER_COLORS[0];
}

export const GENRES = [
  'Fantasy',
  'Sci-fi',
  'Literary',
  'Mystery',
  'Romance',
  'Thriller',
  'Historical',
  'Poetry',
  'Non-fiction',
  'Memoir',
];

export const ME = 'You';
