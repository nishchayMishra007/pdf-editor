"use client";

import React from "react";
import { Button } from "./ui/button";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[UI ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 p-8 text-center dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Something went wrong
          </h1>
          <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
            {this.state.error.message || "An unexpected error occurred in the editor."}
          </p>
          <Button
            onClick={() => {
              this.setState({ error: null });
              window.location.href = "/";
            }}
          >
            Reload editor
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
