import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      className="py-24"
      icon={<Compass className="size-5" />}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={
        <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
          Back to dashboard
        </Link>
      }
    />
  );
}
