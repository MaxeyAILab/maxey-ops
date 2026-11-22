"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { PostInstructionForm } from "@/components/instruction-actions";

type Option = { id: string; name: string };

/**
 * "+ New assignment": the existing PostInstructionForm in a pop-up (same fields, same API). Opens by itself when the page is reached
 * with #new (the mobile + button / quick action).
 */
export function NewAssignmentDialog({
  projects,
  employees,
  postedByName,
}: {
  projects: Option[];
  employees: { id: string; name: string; position: string | null }[];
  postedByName: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#new") setOpen(true);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fx-grad inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110"
      >
        <span aria-hidden className="text-lg leading-none">
          +
        </span>{" "}
        New assignment
      </button>
      {open && (
        <Modal title="New assignment" onClose={() => setOpen(false)} wide>
          <PostInstructionForm
            projects={projects}
            employees={employees}
            postedByName={postedByName}
            onPosted={() => {
              setOpen(false);
              if (window.location.hash === "#new") history.replaceState(null, "", window.location.pathname + window.location.search);
            }}
          />
        </Modal>
      )}
    </>
  );
}
