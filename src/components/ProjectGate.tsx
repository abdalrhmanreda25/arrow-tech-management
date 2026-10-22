'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useOrg } from '@/components/providers/OrgProvider'
import { Empty, Loading } from '@/components/ui/States'
import type { Project } from '@/lib/types'

/** Renders children only once a project is selected; otherwise explains how to get one. */
export default function ProjectGate({ children }: { children: (project: Project) => ReactNode }) {
  const { project, projectsLoading, projects, can } = useOrg()
  if (projectsLoading) return <Loading />
  if (!project) {
    return (
      <Empty
        icon="briefcase"
        title={projects.length ? 'Pick a project' : 'No projects yet'}
        action={
          can('projects.manage') ? (
            <Link className="btn btn-accent btn-sm" href="/projects/">
              {projects.length ? 'Open projects' : 'Create a project'}
            </Link>
          ) : null
        }
      >
        {projects.length
          ? 'Choose a project in the switcher at the top of the page.'
          : can('projects.manage')
            ? 'Backlogs, boards and sprints belong to a project.'
            : 'Ask a manager to create a project and this view will fill in.'}
      </Empty>
    )
  }
  return <>{children(project)}</>
}
