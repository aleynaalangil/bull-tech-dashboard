import React from 'react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; message: string; }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || String(error) };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <div className="p-4 text-red-500 bg-black h-full flex items-center justify-center font-mono text-center">Chart Error: {this.state.message}</div>;
    }
    return this.props.children;
  }
}
