import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import React from "react";
import { EnvelopeIcon, PhoneIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'

const items = [
  { id: 1, title: 'Back End Developer', department: 'Engineering', type: 'Full-time', location: 'Remote' },
  { id: 2, title: 'Front End Developer', department: 'Engineering', type: 'Full-time', location: 'Remote' },
  { id: 3, title: 'User Interface Designer', department: 'Design', type: 'Full-time', location: 'Remote' },
]

const tagsList = [
  {
    name: "Впечатления о фильме",
    popularity: "100",
    description:
      "Посты с впечатлениями о фильмах.",
  },
  {
    name: "Предъява админу",
    popularity: "100",
    description:
      "Задайте вопрос администрации при возникновении проблемы с сайтом",
  },
  {
    name: "Интересный факт",
    popularity: "120",
    description:
      "Похвастайтесь своими знаниями в области киномотографии",
  },
  {
    name: "Фандом фильма",
    popularity: "120",
    description:
      "Посты в области определенного фильма",
  },
  {
    name: "Пасхалки",
    popularity: "100",
    description:
      "Нашли пасхалки в фильме? Напишите об этом",
  },
  {
    name: "Ляпы",
    popularity: "100",
    description:
      "Нашли ляпы в фильме? Напишите об этом",
  }
];

export default function Tags() {
  const tabs = [
    { name: "Порулярное", href: "#", current: true },
    { name: "Имя", href: "#", current: false },
    { name: "Новое", href: "#", current: false },
  ];
  function classNames(...classes) {
    return classes.filter(Boolean).join(" ");
  }
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl mb-1">Теги</h1>
        <p>
          Используй теги для простой навигации по нашему сайту. <br></br>
        </p>
      </div>
      <div className="grid grid-cols-5 gap-4 items-center mb-4">
        <div className="col-span-1 relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MagnifyingGlassIcon
              className="h-5 w-5 text-gray-400"
              aria-hidden="true"
            />
          </div>
          <input
            id="search"
            name="search"
            className="block w-40 sm:w-80 rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-gray-500 focus:border-rose-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-rose-500 sm:text-sm"
            placeholder="Название тега"
            type="search"
          />
        </div>
        <div className="col-span-2"></div>
        <div className="col-span-2 px-4 sm:px-0">
          <div className="sm:hidden">
            <label htmlFor="question-tabs" className="sr-only">
              Select a tab
            </label>
            <select
              id="question-tabs"
              className="block w-full rounded-md border-gray-300 text-base font-medium text-gray-900 shadow-sm focus:border-rose-500 focus:ring-rose-500"
              defaultValue={tabs.find((tab) => tab.current).name}
            >
              {tabs.map((tab) => (
                <option key={tab.name}>{tab.name}</option>
              ))}
            </select>
          </div>
          <div className="hidden sm:block">
            <nav
              className="isolate flex divide-x divide-gray-200 rounded-lg shadow"
              aria-label="Tabs"
            >
              {tabs.map((tab, tabIdx) => (
                <a
                  key={tab.name}
                  href={tab.href}
                  aria-current={tab.current ? "page" : undefined}
                  className={classNames(
                    tab.current
                      ? "text-gray-900"
                      : "text-gray-500 hover:text-gray-700",
                    tabIdx === 0 ? "rounded-l-lg" : "",
                    tabIdx === tabs.length - 1 ? "rounded-r-lg" : "",
                    "group relative min-w-0 flex-1 overflow-hidden bg-white py-4 px-6 text-xs font-medium text-center hover:bg-gray-50 focus:z-10"
                  )}
                >
                  <span>{tab.name}</span>
                  <span
                    aria-hidden="true"
                    className={classNames(
                      tab.current ? "bg-rose-500" : "bg-transparent",
                      "absolute inset-x-0 bottom-0 h-0.5"
                    )}
                  />
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <ul
        role="list"
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
      >
        {tagsList.map((tag) => (
          <li
            key={tag.name}
            className="col-span-1 flex flex-col divide-y divide-gray-200 rounded-lg bg-white  shadow"
          >
            <div className="flex flex-1 flex-col p-5">
              <Link href="#">
                <button
                  type="button"
                  className="inline-flex items-center rounded-sm border border-gray-500 bg-white px-1 py-0.5 text-sm mb-1 font-normal text-gray-500 hover:bg-blue-600 indigo-500 hover:text-white focus:outline-none"
                >
                  {tag.name}
                </button>

                <article className="text-sm text-gray-800 ">
                  {tag.description.slice(0, 130)}
                </article>
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className=" mt-5 flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex flex-1 justify-between sm:hidden">
        <a
          href="#"
          className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Previous
        </a>
        <a
          href="#"
          className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Next
        </a>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700">
            Showing <span className="font-medium">1</span> to <span className="font-medium">10</span> of{' '}
            <span className="font-medium">97</span> results
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
            {/* Current: "z-10 bg-indigo-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600", Default: "text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-offset-0" */}
            
          </nav>
        </div>
      </div>
    </div>
      
    </>
  );
}
