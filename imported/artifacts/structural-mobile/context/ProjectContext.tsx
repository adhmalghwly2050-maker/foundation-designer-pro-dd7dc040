import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Beam {
  id: string;
  width: number;
  depth: number;
  span: number;
  deadLoad: number;
  liveLoad: number;
  fc: number;
  fy: number;
}

export interface Column {
  id: string;
  width: number;
  depth: number;
  height: number;
  axialLoad: number;
  momentX: number;
  momentY: number;
  fc: number;
  fy: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  beams: Beam[];
  columns: Column[];
}

interface ProjectContextType {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;
  addProject: (name: string, description: string) => Project;
  updateProject: (project: Project) => void;
  deleteProject: (id: string) => void;
  addBeam: (beam: Omit<Beam, "id">) => void;
  updateBeam: (beam: Beam) => void;
  deleteBeam: (id: string) => void;
  addColumn: (col: Omit<Column, "id">) => void;
  updateColumn: (col: Column) => void;
  deleteColumn: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

const STORAGE_KEY = "structural_projects";

function genId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) {
        const parsed: Project[] = JSON.parse(data);
        setProjects(parsed);
        if (parsed.length > 0) setCurrentProject(parsed[0]);
      }
    });
  }, []);

  const save = (updated: Project[]) => {
    setProjects(updated);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const addProject = (name: string, description: string): Project => {
    const p: Project = {
      id: genId(),
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beams: [],
      columns: [],
    };
    const updated = [p, ...projects];
    save(updated);
    setCurrentProject(p);
    return p;
  };

  const updateProject = (project: Project) => {
    const updated = projects.map((p) =>
      p.id === project.id ? { ...project, updatedAt: new Date().toISOString() } : p
    );
    save(updated);
    if (currentProject?.id === project.id) setCurrentProject({ ...project, updatedAt: new Date().toISOString() });
  };

  const deleteProject = (id: string) => {
    const updated = projects.filter((p) => p.id !== id);
    save(updated);
    if (currentProject?.id === id) setCurrentProject(updated[0] ?? null);
  };

  const getCurrentAndUpdate = (fn: (p: Project) => Project) => {
    if (!currentProject) return;
    const updated = fn(currentProject);
    updateProject(updated);
  };

  const addBeam = (beam: Omit<Beam, "id">) => {
    getCurrentAndUpdate((p) => ({ ...p, beams: [...p.beams, { ...beam, id: genId() }] }));
  };
  const updateBeam = (beam: Beam) => {
    getCurrentAndUpdate((p) => ({ ...p, beams: p.beams.map((b) => (b.id === beam.id ? beam : b)) }));
  };
  const deleteBeam = (id: string) => {
    getCurrentAndUpdate((p) => ({ ...p, beams: p.beams.filter((b) => b.id !== id) }));
  };
  const addColumn = (col: Omit<Column, "id">) => {
    getCurrentAndUpdate((p) => ({ ...p, columns: [...p.columns, { ...col, id: genId() }] }));
  };
  const updateColumn = (col: Column) => {
    getCurrentAndUpdate((p) => ({ ...p, columns: p.columns.map((c) => (c.id === col.id ? col : c)) }));
  };
  const deleteColumn = (id: string) => {
    getCurrentAndUpdate((p) => ({ ...p, columns: p.columns.filter((c) => c.id !== id) }));
  };

  return (
    <ProjectContext.Provider
      value={{
        projects,
        currentProject,
        setCurrentProject,
        addProject,
        updateProject,
        deleteProject,
        addBeam,
        updateBeam,
        deleteBeam,
        addColumn,
        updateColumn,
        deleteColumn,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
