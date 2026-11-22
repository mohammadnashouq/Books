import { uid } from '../lib/utils.js';

const daysAgo = (d, h = 0) => new Date(Date.now() - (d * 24 + h) * 3600 * 1000).toISOString();

function chapter(title, text = '') {
  return { id: uid(), title, text };
}

// Sample content shown on first run. Edit or delete it in the app.
export function createSampleBooks() {
  const lantern = [
    chapter(
      'The Last Lamp',
      'Every evening for forty years, the lighthouse on Gull Point had been the first light lit and the last put out.\n\nWren had climbed its stairs since she was old enough to carry the oil can.',
    ),
    chapter(
      'A Town Without Light',
      'The lamps went out one by one, the way a choir falls quiet when the hymn has run out of verses.\n\nWren stood at the top of the lighthouse stairs and counted them from memory: the baker’s, the ferryman’s, the long row along the harbour wall. Below her the town held its breath.\n\n“Wren?” Orin called up from the dark. “Are you there?”\n\nWren didn’t answer. She was listening for the one sound that should never stop — the slow tick of the great lantern turning — and hearing nothing at all.',
    ),
    chapter('Salt in the Wick'),
  ];

  return [
    {
      id: uid(),
      title: 'The Lantern Keeper',
      genre: 'Fantasy',
      status: 'progress',
      goal: 80000,
      color: 'violet',
      createdAt: daysAgo(40),
      updatedAt: daysAgo(0, 2),
      chapters: lantern,
      comments: [
        {
          id: uid(),
          chapterId: lantern[1].id,
          author: 'Maya (beta reader)',
          text: 'Love this image. Could the town react a beat sooner so the dread builds?',
          quote: 'The lamps went out one by one',
          resolved: false,
          createdAt: daysAgo(0, 1),
        },
        {
          id: uid(),
          chapterId: lantern[1].id,
          author: 'You',
          text: 'Note to self: check Orin’s age against chapter 1.',
          quote: '',
          resolved: false,
          createdAt: daysAgo(1),
        },
        {
          id: uid(),
          chapterId: lantern[1].id,
          author: 'Sam (editor)',
          text: 'Nice restraint here — keep it.',
          quote: 'Wren didn’t answer.',
          resolved: true,
          createdAt: daysAgo(3),
        },
      ],
    },
    {
      id: uid(),
      title: 'Salt & Static',
      genre: 'Sci-fi',
      status: 'draft',
      goal: 60000,
      color: 'teal',
      createdAt: daysAgo(10),
      updatedAt: daysAgo(1),
      chapters: [chapter('Signal', 'The radio had been silent for nine days when it finally spoke.')],
      comments: [],
    },
    {
      id: uid(),
      title: 'Letters to Juniper',
      genre: 'Literary',
      status: 'published',
      goal: 70000,
      color: 'coral',
      createdAt: daysAgo(200),
      updatedAt: daysAgo(30),
      chapters: [chapter('Dear Juniper')],
      comments: [],
    },
    {
      id: uid(),
      title: 'Small Hours',
      genre: 'Poetry',
      status: 'draft',
      goal: 20000,
      color: 'amber',
      createdAt: daysAgo(14),
      updatedAt: daysAgo(6),
      chapters: [chapter('Part One')],
      comments: [],
    },
  ];
}
